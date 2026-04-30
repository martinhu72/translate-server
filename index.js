const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" } 
});

// 模拟一个简单的内存数据库来存储房间号
let savedRoomId = "888888"; 

io.on('connection', (socket) => {
    // 当 App 启动时，询问服务器：现在的房间号是多少？
    socket.on('get-current-room', () => {
        socket.emit('current-room-is', savedRoomId);
    });

    // 当 App 点击“重置”时，服务器更新房间号
    socket.on('update-room-id', (newId) => {
        savedRoomId = newId;
        console.log("房间号已更新为:", savedRoomId);
    });

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
    console.log('Server running');
});
