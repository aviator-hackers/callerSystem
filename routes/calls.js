const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const db = require('../database/db');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

router.post('/initiate', async (req, res) => {
    const { phone_number, full_name, subject, custom_intro } = req.body;
    const io = req.app.get('io');
    
    console.log('Initiating call to:', phone_number);
    
    try {
        let contact = await db.query(
            `SELECT id FROM contacts WHERE phone_number = $1`,
            [phone_number]
        );
        
        let contactId;
        if (contact.rows.length === 0) {
            const newContact = await db.query(
                `INSERT INTO contacts (phone_number, full_name, status) VALUES ($1, $2, $3) RETURNING id`,
                [phone_number, full_name || null, 'pending']
            );
            contactId = newContact.rows[0].id;
        } else {
            contactId = contact.rows[0].id;
            if (full_name) {
                await db.query(`UPDATE contacts SET full_name = $1 WHERE id = $2`, [full_name, contactId]);
            }
        }
        
        const session = await db.query(
            `INSERT INTO call_sessions (contact_id, subject, custom_intro, status, current_action) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [contactId, subject || null, custom_intro || null, 'initiated', 'consent']
        );
        
        const sessionId = session.rows[0].id;
        const serverUrl = 'https://' + req.get('host');
        
        console.log('Session ID:', sessionId);
        console.log('Webhook URL:', `${serverUrl}/webhooks/voice-response/${sessionId}`);
        
        const call = await client.calls.create({
            url: `${serverUrl}/webhooks/voice-response/${sessionId}`,
            to: phone_number,
            from: process.env.TWILIO_PHONE_NUMBER,
            statusCallback: `${serverUrl}/webhooks/call-status/${sessionId}`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            statusCallbackMethod: 'POST'
        });
        
        await db.query(`UPDATE call_sessions SET call_sid = $1 WHERE id = $2`, [call.sid, sessionId]);
        
        io.emit('call_initiated', {
            session_id: sessionId,
            phone_number: phone_number,
            full_name: full_name,
            status: 'initiated'
        });
        
        res.json({ success: true, session_id: sessionId, call_sid: call.sid });
        
    } catch (error) {
        console.error('Error initiating call:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/send-custom-voice/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { message } = req.body;
    const io = req.app.get('io');
    
    try {
        await db.query(
            `INSERT INTO admin_logs (session_id, action_type, action_value) VALUES ($1, $2, $3)`,
            [sessionId, 'custom_voice', message]
        );
        
        io.emit('custom_voice_sent', { session_id: sessionId, message: message });
        
        res.json({ success: true, message: 'Custom voice command sent' });
    } catch (error) {
        console.error('Error sending custom voice:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
