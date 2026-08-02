const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// 服务端核心状态内存池：持久化记录房间状态与听众集合
// rooms[roomId] = { isLive: false, listeners: Set(socket.id), interpreterId: socket.id }
const rooms = {};

function getOrCreateRoom(roomId) {
    if (!rooms[roomId]) {
        rooms[roomId] = {
            isLive: false,
            listeners: new Set(),
            interpreterId: null
        };
    }
    return rooms[roomId];
}

// 向房间内全员广播同步当前房间状态和听众总数
function broadcastRoomStatus(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const listenersCount = room.listeners.size;
    const status = room.isLive ? 'live' : 'paused';

    io.to(roomId).emit('status-updated', {
        status: status,
        listenersCount: listenersCount
    });
}

io.on('connection', (socket) => {
    console.log('用户已连接:', socket.id);

    // 1. 口译员加入房间
    socket.on('join-as-interpreter', (roomId) => {
        if (!roomId) return;
        socket.join(roomId);
        socket.roomId = roomId;
        socket.role = 'interpreter';

        const room = getOrCreateRoom(roomId);
        room.interpreterId = socket.id;

        // 向房间同步状态与人数
        broadcastRoomStatus(roomId);
        console.log(`译员 ${socket.id} 加入房间 ${roomId}`);
    });

    // 2. 听众加入房间
    socket.on('join-room', (roomId) => {
        if (!roomId) return;
        socket.join(roomId);
        socket.roomId = roomId;
        socket.role = 'listener';

        const room = getOrCreateRoom(roomId);
        room.listeners.add(socket.id);

        // 听众加入，立即同步房间的当前直播状态和更新听众人数
        broadcastRoomStatus(roomId);
        console.log(`听众 ${socket.id} 加入房间 ${roomId}，当前人数: ${room.listeners.size}`);
    });

    // 3. 口译员切换直播状态（开始/暂停）
    socket.on('toggle-live', ({ roomId, isLive }) => {
        const room = getOrCreateRoom(roomId);
        room.isLive = isLive;

        console.log(`房间 ${roomId} 直播状态更新为: ${isLive ? 'LIVE' : 'PAUSED'}`);
        broadcastRoomStatus(roomId);
    });

    // 4. WebRTC 信令透传转发 (Offer / Answer / Candidate)
    socket.on('signal', (data) => {
        if (data.to) {
            io.to(data.to).emit('signal', data);
        }
    });

    // 5. 断开连接处理（自动清理听众人数与房间）
    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];

            if (socket.role === 'listener') {
                room.listeners.delete(socket.id);
                console.log(`听众 ${socket.id} 离开房间 ${roomId}，剩余人数: ${room.listeners.size}`);
                broadcastRoomStatus(roomId);
            } else if (socket.role === 'interpreter') {
                if (room.interpreterId === socket.id) {
                    room.interpreterId = null;
                    room.isLive = false; // 译员离线，自动暂停直播
                    console.log(`译员离开，房间 ${roomId} 自动暂停`);
                    broadcastRoomStatus(roomId);
                }
            }

            // 若房间没人也没译员，清理内存
            if (room.listeners.size === 0 && !room.interpreterId) {
                delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`同声传译服务已成功启动，运行端口: ${PORT}`);
});
