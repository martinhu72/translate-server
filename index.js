const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 1. 基础健康检查路由（针对 Render/Heroku 探针及防止部署失败）
app.get('/', (req, res) => {
    res.send('Live Interpretation Signaling Server is Running.');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const io = new Server(server, {
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"] 
    },
    // 针对移动端频繁网络切换优化心跳检测参数
    pingTimeout: 10000,
    pingInterval: 5000
});

// 服务端核心状态内存池
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
        listenersCount: listenersCount,
        interpreterOnline: !!room.interpreterId
    });
}

// 辅助函数：从当前 Socket 的旧角色和旧房间中安全清除
function cleanUpSocketRole(socket) {
    const { roomId, role } = socket;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];

    if (role === 'listener') {
        room.listeners.delete(socket.id);
        console.log(`听众 ${socket.id} 离开房间 ${roomId}，剩余听众: ${room.listeners.size}`);
    } else if (role === 'interpreter') {
        if (room.interpreterId === socket.id) {
            room.interpreterId = null;
            room.isLive = false; // 译员离线，自动暂停直播
            console.log(`译员 ${socket.id} 离开，房间 ${roomId} 自动暂停直播`);
        }
    }

    // 广播状态更新
    broadcastRoomStatus(roomId);

    // 若房间没人也没译员，清理内存
    if (room.listeners.size === 0 && !room.interpreterId) {
        delete rooms[roomId];
        console.log(`房间 ${roomId} 已清空并从内存中销毁`);
    }
}

io.on('connection', (socket) => {
    console.log('用户已连接:', socket.id);

    // 1. 口译员加入房间
    socket.on('join-as-interpreter', (roomId) => {
        if (!roomId) return;

        // 如果该 socket 之前已经在其他房间或有其他身份，先清理
        cleanUpSocketRole(socket);

        socket.join(roomId);
        socket.roomId = roomId;
        socket.role = 'interpreter';

        const room = getOrCreateRoom(roomId);
        room.interpreterId = socket.id;

        // 向房间同步状态与人数
        broadcastRoomStatus(roomId);
        console.log(`译员 ${socket.id} 成功加入房间 ${roomId}`);
    });

    // 2. 听众加入房间
    socket.on('join-room', (roomId) => {
        if (!roomId) return;

        // 如果该 socket 之前已经在其他房间或有其他身份，先清理
        cleanUpSocketRole(socket);

        socket.join(roomId);
        socket.roomId = roomId;
        socket.role = 'listener';

        const room = getOrCreateRoom(roomId);
        room.listeners.add(socket.id);

        // 听众加入，立即同步房间的当前直播状态和更新听众人数
        broadcastRoomStatus(roomId);
        console.log(`听众 ${socket.id} 加入房间 ${roomId}，当前听众数: ${room.listeners.size}`);
    });

    // 3. 口译员切换直播状态（开始/暂停）
    socket.on('toggle-live', ({ roomId, isLive }) => {
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        // 校验：仅允许当前房间绑定的译员修改状态
        if (socket.role === 'interpreter' && room.interpreterId === socket.id) {
            room.isLive = !!isLive;
            console.log(`房间 ${roomId} 直播状态更新为: ${room.isLive ? 'LIVE' : 'PAUSED'}`);
            broadcastRoomStatus(roomId);
        }
    });

    // 4. WebRTC 信令透传转发 (Offer / Answer / Candidate)
    socket.on('signal', (data) => {
        if (data && data.to) {
            // 确保透传数据中有安全的 from 标识，防止前端拿到空来源
            data.from = socket.id;
            io.to(data.to).emit('signal', data);
        }
    });

    // 5. 断开连接处理（自动清理听众人数与房间）
    socket.on('disconnect', () => {
        cleanUpSocketRole(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`同声传译服务已成功启动，运行端口: ${PORT}`);
});
