function generateSessionId() {
    return Math.random().toString(36).substring(2, 15);
}

function formatPhoneNumber(number) {
    return number.replace(/\D/g, '');
}

module.exports = {
    generateSessionId,
    formatPhoneNumber
};