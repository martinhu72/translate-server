const express = require('express');
const app = express();
const http = require('http').createServer(app);

// Socket.IO 优化配置：加入 pingInterval 与 pingTimeout 保持长连接活跃
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingInterval: 10000, // 每 10 秒心跳一次，防止路由器断掉闲置 TCP 链接
    pingTimeout: 30000   // 30 秒超时自动重连
});

const audienceDomain = "https://uscnl.com/translate/";

// 内存状态机
const roomStates = {};       // { roomId: 'live' | 'paused' }
const roomInterpreters = {}; // { roomId: interpreterSocketId }

app.get('/', (req, res) => {
    res.send('Translation Signaling Server is Running Perfectly!');
});

io.on('connection', (socket) => {
    console.log(`[连接成功] Socket ID: ${socket.id}`);

    // 口译员注册登录
    socket.on('register-interpreter', (data) => {
        const { name, roomId } = data;
        if (!name || !roomId) return;

        console.log(`[口译员登录] 姓名: ${name} | 房间: ${roomId} | ID: ${socket.id}`);

        roomInterpreters[roomId] = socket.id;
        socket.roomId = roomId;
        socket.isInterpreter = true;

        if (!roomStates[roomId]) {
            roomStates[roomId] = 'paused';
        }

        socket.emit('interpreter-registered', {
            roomId: roomId,
            domain: audienceDomain
        });

        // 追溯早于口译员进入的听众，指示口译端进行补连
        const room = io.sockets.adapter.rooms.get(roomId);
        if (room) {
            room.forEach((clientId) => {
                if (clientId !== socket.id) {
                    socket.emit('new-user-joined', clientId);
                }
            });
        }
    });

    // 加入房间
    socket.on('join-room', (roomId) => {
        if (!roomId) return;
        
        socket.join(roomId);
        socket.roomId = roomId;

        // 推送最新状态给刚加入的客户端
        const currentStatus = roomStates[roomId] || 'paused';
        socket.emit('status-updated', currentStatus);

        // 精准通知口译员：有新听众加入，建立音轨通道
        const interpreterSocketId = roomInterpreters[roomId];
        if (interpreterSocketId && interpreterSocketId !== socket.id) {
            io.to(interpreterSocketId).emit('new-user-joined', socket.id);
        }

        broadcastAudienceCount(roomId);
    });

    // P2P 信令转发
    socket.on('signal', (data) => {
        const toId = data.to;
        if (toId) {
            data.from = socket.id;
            io.to(toId).emit('signal', data);
        }
    });

    // 口译员切流状态变化（Live / Paused）
    socket.on('interpreter-status', (data) => {
        if (!data) return;
        const { roomId, status } = data;
        if (roomId && (status === 'live' || status === 'paused')) {
            roomStates[roomId] = status;
            io.to(roomId).emit('status-updated', status);
            io.to(roomId).emit('interpreter-status', data);
        }
    });

    // 断开连接清理逻辑
    socket.on('disconnecting', () => {
        const roomId = socket.roomId;
        if (socket.isInterpreter && roomId && roomInterpreters[roomId] === socket.id) {
            delete roomInterpreters[roomId];
            io.to(roomId).emit('status-updated', 'paused');
        }
        if (roomId) {
            setTimeout(() => broadcastAudienceCount(roomId), 500);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[断开连接] Socket ID: ${socket.id}`);
    });
});

function broadcastAudienceCount(roomId) {
    const room = io.sockets.adapter.rooms.get(roomId);
    let count = 0;
    if (room) {
        const interpreterSocketId = roomInterpreters[roomId];
        count = room.size - (interpreterSocketId && room.has(interpreterSocketId) ? 1 : 0);
    }
    io.to(roomId).emit('update-audience-count', Math.max(0, count));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`信令服务器已成功启动！端口: ${PORT}`);
});
