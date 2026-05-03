const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

// =================== 全局配置：听众端网站域名 ===================
// 以后更换网站时，只需修改这里的网址，提交到 GitHub 即可，无需重新打包 APK！
const audienceDomain = "https://uscnl.com/translate/";
// =============================================================

// 服务端内存状态机：用于记录各个房间的直播状态
const roomStates = {};

io.on('connection', (socket) => {
    console.log('新客户端连接:', socket.id);

    // 口译员带着手机本地缓存的“姓名+房间号”向服务器登记
    socket.on('register-interpreter', (data) => {
        const { name, roomId } = data;
        if (!name || !roomId) return;

        console.log(`口译员 [${name}] 携带房间号 [${roomId}] 登录并激活房间`);
        
        // 如果房间在服务器端没有状态记录，初始化为暂停状态
        if (!roomStates[roomId]) {
            roomStates[roomId] = 'paused';
        }

        // 告诉口译员：服务器已经登记好该房间，并把最新的听众端域名返回给 App 客户端
        socket.emit('interpreter-registered', {
            roomId: roomId,
            domain: audienceDomain
        });
    });

    // 无论是口译员还是听众，加入指定的房间
    socket.on('join-room', (roomId) => {
        if (!roomId) return;
        socket.join(roomId);
        console.log(`Socket [${socket.id}] 加入房间: ${roomId}`);

        // 1. 获取房间当前状态，默认为 paused
        const currentStatus = roomStates[roomId] || 'paused';
        
        // 2. 单独向刚加入的这个客户端推送房间当前的状态
        socket.emit('status-updated', currentStatus);

        // 3. 【核心修改】无条件通知房间内的口译员：有新听众进入，立即开始打通 WebRTC
        // 即使当前是 'paused' 状态，也要先把底层声音传输管道接通
        socket.to(roomId).emit('new-user-joined', socket.id);
        
        // 广播当前听众人数
        broadcastAudienceCount(roomId);
    });

    // WebRTC 核心信令转发
    socket.on('signal', (data) => {
        const toId = data.to;
        if (toId) {
            data.from = socket.id;
            io.to(toId).emit('signal', data);
        }
    });

    // 口译员更新直播/暂停状态
    socket.on('interpreter-status', (data) => {
        if (!data) return;
        const { roomId, status } = data;
        if (roomId && (status === 'live' || status === 'paused')) {
            console.log(`房间 [${roomId}] 状态更新为: ${status}`);
            
            // 缓存房间最新状态到内存中
            roomStates[roomId] = status;

            // 广播给房间内的所有人改变 UI 状态
            io.to(roomId).emit('status-updated', status);
            io.to(roomId).emit('interpreter-status', data); // 冗余发送，确保兼容
        }
    });

    // 听众断开连接时，更新人数统计
    socket.on('disconnecting', () => {
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                setTimeout(() => broadcastAudienceCount(room), 500);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('客户端断开:', socket.id);
    });
});

function broadcastAudienceCount(roomId) {
    const clients = io.sockets.adapter.rooms.get(roomId);
    const count = clients ? clients.size : 0;
    // 听众人数 = 总人数 - 1（刨除口译员自己）
    const audienceCount = Math.max(0, count - 1);
    io.to(roomId).emit('update-audience-count', audienceCount);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`服务器正在端口 ${PORT} 上运行`);
});
