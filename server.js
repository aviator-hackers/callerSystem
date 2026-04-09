require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const callsRoutes = require('./routes/calls');
const webhooksRoutes = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/audio', express.static('audio'));

app.set('io', io);

app.use('/api/calls', callsRoutes);
app.use('/webhooks', webhooksRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log('Admin connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('Admin disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
});
