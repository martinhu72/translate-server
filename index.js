const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 统一的 ICE / TURN 服务器配置 (包含 TURN 中继，解决 Google WiFi 穿透问题)
// 生产环境建议替换为您自己搭建的 Coturn 服务器或 Twilio/Xirsys 等付费 TURN 服务
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:openrelay.metered.ca:80" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject"
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject"
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject"
  }
];

// 数据结构维护：roomId -> { interpreterSocketId, status, listeners: Set }
const rooms = new Map();

// HTTP 接口：暴露 ICE 配置供前端获取
app.get('/api/ice-servers', (req, res) => {
  res.json({ iceServers: ICE_SERVERS });
});

io.on('connection', (socket) => {
  console.log(`[连接成功] Socket ID: ${socket.id}`);

  // 1. 译员注册房间
  socket.on('register-interpreter', ({ roomId, name }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = 'interpreter';

    let room = rooms.get(roomId) || { interpreterSocketId: null, status: 'paused', listeners: new Set() };
    room.interpreterSocketId = socket.id;
    rooms.set(roomId, room);

    console.log(`[译员上线] 房间号: ${roomId}, 译员: ${name}`);
    
    // 下发 ICE 配置
    socket.emit('ice-config', { iceServers: ICE_SERVERS });
  });

  // 2. 听众加入房间
  socket.on('join-listener', ({ roomId }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = 'listener';

    const room = rooms.get(roomId);
    if (room && room.interpreterSocketId) {
      room.listeners.add(socket.id);
      
      // 下发 ICE 配置
      socket.emit('ice-config', { iceServers: ICE_SERVERS, status: room.status });

      // 通知译员有新听众加入，触发 P2P Offer
      io.to(room.interpreterSocketId).emit('new-user-joined', { socketId: socket.id });

      // 广播更新听众人数
      io.to(roomId).emit('listener-count-update', room.listeners.size);
      console.log(`[听众加入] 房间号: ${roomId}, 当前听众数: ${room.listeners.size}`);
    } else {
      socket.emit('room-error', { message: "译员尚未上线或房间不存在" });
    }
  });

  // 3. 信令转发：SDP Offer (译员 -> 听众)
  socket.on('offer', ({ target, sdp }) => {
    io.to(target).emit('offer', { sender: socket.id, sdp });
  });

  // 4. 信令转发：SDP Answer (听众 -> 译员)
  socket.on('answer', ({ target, sdp }) => {
    io.to(target).emit('answer', { sender: socket.id, sdp });
  });

  // 5. 信令转发：ICE Candidate (双向)
  socket.on('ice-candidate', ({ target, candidate }) => {
    io.to(target).emit('ice-candidate', { sender: socket.id, candidate });
  });

  // 6. 译员切换直播 / 静音状态
  socket.on('interpreter-status-change', ({ roomId, status }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.status = status;
      // 广播给房间内的所有听众
      socket.to(roomId).emit('status-changed', { status });
      console.log(`[状态变更] 房间号: ${roomId}, 新状态: ${status}`);
    }
  });

  // 7. 断开连接与退房逻辑处理
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (socket.role === 'interpreter') {
      console.log(`[译员下线] 房间号: ${roomId}`);
      room.interpreterSocketId = null;
      io.to(roomId).emit('interpreter-offline');
    } else if (socket.role === 'listener') {
      room.listeners.delete(socket.id);
      console.log(`[听众离开] 房间号: ${roomId}, 剩余听众: ${room.listeners.size}`);

      // 通知译员销毁该听众的 PeerConnection
      if (room.interpreterSocketId) {
        io.to(room.interpreterSocketId).emit('user-left', { socketId: socket.id });
      }

      // 更新听众人数
      io.to(roomId).emit('listener-count-update', room.listeners.size);
    }

    if (!room.interpreterSocketId && room.listeners.size === 0) {
      rooms.delete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`同传信令服务器已启动，端口: ${PORT}`);
});
