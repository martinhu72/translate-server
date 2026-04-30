const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" } 
});

io.on('connection', (socket) => {
    console.log('用户连接:', socket.id);
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
    });
    socket.on('interpreter-status', (data) => {
        if (data.roomId) {
            io.to(data.roomId).emit('interpreter-status', data);
        }
    });
    socket.on('signal', (data) => {
        if (data.to) {
            io.to(data.to).emit('signal', { from: socket.id, ...data });
        } else if (data.roomId) {
            socket.to(data.roomId).emit('signal', { from: socket.id, ...data });
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
});
