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

io.on('connection', (socket) => {
    console.log('新客户端连接:', socket.id);

    // 口译员带着手机本地缓存的“姓名+房间号”向服务器登记
    socket.on('register-interpreter', (data) => {
        const { name, roomId } = data;
        if (!name || !roomId) return;

        console.log(`口译员 [${name}] 携带房间号 [${roomId}] 登录并激活房间`);
        
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

        // 通知房间内的口译员有新听众进入，开始触发 WebRTC 握手
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
        const { roomId, status } = data;
        if (roomId) {
            socket.to(roomId).emit('status-updated', status);
        }
    });

    // =================== 核心修复：转发重连请求 ===================
    // 口译员恢复直播时主动触发，通知房间内的听众进行 WebRTC 重建
    socket.on('request-reconnect', (data) => {
        if (!data) return;
        // 兼容处理 data 为对象或字符串的情况
        const roomId = typeof data === 'object' ? data.roomId : data;
        if (roomId) {
            console.log(`房间 [${roomId}] 收到重连指令，广播给全体听众。`);
            socket.to(roomId).emit('request-reconnect');
        }
    });
    // =============================================================

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
