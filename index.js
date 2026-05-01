const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" } 
});

// 模拟一个简单的内存数据库来存储房间号
let savedRoomId = "123456"; 

/**
 * 辅助函数：计算并广播房间内的听众人数
 * @param {string} roomId 房间ID
 */
const broadcastAudienceCount = (roomId) => {
    if (!roomId) return;
    
    // 获取当前房间的所有客户端 Socket ID 集合
    const clients = io.sockets.adapter.rooms.get(roomId);
    const totalClients = clients ? clients.size : 0;
    
    // 逻辑：总人数减去 1 (口译员自己)，得到听众人数
    const audienceCount = Math.max(0, totalClients - 1);
    
    console.log(`房间 ${roomId} 当前听众数量: ${audienceCount}`);
    
    // 向该房间内的所有人广播最新人数
    io.to(roomId).emit('update-audience-count', audienceCount);
};

io.on('connection', (socket) => {
    
    // 1. 获取当前房间号
    socket.on('get-current-room', () => {
        socket.emit('current-room-is', savedRoomId);
    });

    // 2. 更新房间号
    socket.on('update-room-id', (newId) => {
        savedRoomId = newId;
        console.log("房间号已更新为:", savedRoomId);
        // 通知所有人房间号已更改
        io.emit('current-room-is', savedRoomId);
    });

    // 3. 加入房间
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`用户 ${socket.id} 加入了房间: ${roomId}`);
        
        // --- 核心修复：通知口译员有新听众加入 ---
        // 我们向房间内的口译员广播这个新用户的 ID
        // socket.to(roomId) 会发送给房间内除自己以外的所有人
        socket.to(roomId).emit('new-user-joined', socket.id);
        
        // 有人进入，更新并广播人数
        broadcastAudienceCount(roomId);
    });

    // 4. 监听断开连接
    socket.on('disconnecting', () => {
        socket.rooms.forEach(roomId => {
            setImmediate(() => {
                broadcastAudienceCount(roomId);
            });
        });
    });

    // 5. 转发口译员状态（直播/暂停）
    socket.on('interpreter-status', (data) => {
        if (data.roomId) {
            io.to(data.roomId).emit('interpreter-status', data);
        }
    });

    // 6. WebRTC 信令转发
    socket.on('signal', (data) => {
        if (data.to) {
            // 定向发送给某个用户（例如口译员发给特定的新听众）
            io.to(data.to).emit('signal', { from: socket.id, ...data });
        } else if (data.roomId) {
            // 在房间内广播
            socket.to(data.roomId).emit('signal', { from: socket.id, ...data });
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`服务器已启动，端口: ${PORT}`);
});
