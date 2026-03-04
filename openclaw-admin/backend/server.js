const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'openclaw-admin-secret-key-2026';
const OPENCLAW_WEBHOOK_URL = process.env.OPENCLAW_WEBHOOK_URL || 'http://127.0.0.1:18789/webhook/permission-update';
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || '/home/ubuntu/.openclaw/openclaw.json';
const GATEWAY_TOKEN = 'openclaw-dingtalk';

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// 数据库初始化
const db = new Database(path.join(__dirname, 'data.db'));

// 初始化数据库表
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    platform TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_active_at TEXT
  );

  CREATE TABLE IF NOT EXISTS platform_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    field_key TEXT NOT NULL,
    field_value TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, field_key)
  );

  CREATE TABLE IF NOT EXISTS user_permissions (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    perm_send_message INTEGER DEFAULT 1,
    perm_receive_message INTEGER DEFAULT 1,
    perm_call_claude_code INTEGER DEFAULT 0,
    perm_modify_server INTEGER DEFAULT 0,
    perm_upload_file INTEGER DEFAULT 1,
    perm_view_logs INTEGER DEFAULT 1,
    rate_daily_messages INTEGER DEFAULT 0,
    rate_max_file_size_mb INTEGER DEFAULT 10,
    rate_max_concurrent INTEGER DEFAULT 5,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS group_configs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    group_enabled INTEGER DEFAULT 0,
    group_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS group_admins (
    id TEXT PRIMARY KEY,
    group_config_id TEXT NOT NULL,
    admin_name TEXT NOT NULL,
    admin_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_config_id) REFERENCES group_configs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// 创建默认管理员
const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admins (id, username, password, email) VALUES (?, ?, ?, ?)').run(
    uuidv4(), 'admin', hashedPassword, 'admin@openclaw.local'
  );
  console.log('默认管理员已创建: admin / admin123');
}

// 平台字段定义
const platformFields = {
  telegram: [
    { name: 'bot_token', label: 'Bot Token', type: 'password', required: true, hint: '获取方式：\n1. 打开 Telegram，搜索 @BotFather\n2. 发送 /newbot 创建新机器人\n3. 复制生成的 Token（格式：1234567890:ABCdefGHIjklmnopQRSTuvwxyz）\n4. 搜索你的机器人并发送 /start 激活' },
    { name: 'bot_username', label: 'Bot Username', type: 'text', required: true, hint: '你的 Bot 用户名（以 @ 开头，如 @my_openclaw_bot）\n在 @BotFather 创建机器人时设置' }
  ],
  discord: [
    { name: 'bot_token', label: 'Bot Token', type: 'password', required: true, hint: '获取方式：\n1. 访问 https://discord.com/developers/applications\n2. 创建或选择你的 Application\n3. 点击左侧 "Bot" 菜单\n4. 点击 "Reset Token" 重置并复制 Token\n5. 确保 MESSAGE CONTENT INTENT 已开启（Bot菜单下方）' },
    { name: 'application_id', label: 'Application ID', type: 'text', required: true, hint: '获取方式：\n1. Discord Developer Portal → 你的 Application\n2. 点击左侧 "General Information"\n3. 复制 "Application ID"' },
    { name: 'guild_id', label: '服务器 ID', type: 'text', required: false, hint: '获取方式：\n1. 开启 Discord 开发者模式（设置 → Advanced → Developer Mode）\n2. 右键服务器图标 → 复制服务器ID\n3. 或者在服务器设置中查看' }
  ],
  slack: [
    { name: 'bot_token', label: 'Bot User OAuth Token', type: 'password', required: true, hint: '获取方式：\n1. 访问 https://api.slack.com/apps\n2. 创建或选择你的 App\n3. 点击 "OAuth & Permissions"\n4. 在 "Bot Token Scopes" 添加必要权限\n5. 点击 "Install to Workspace" 安装\n6. 复制 "Bot User OAuth Token"（以 xoxb- 开头）' },
    { name: 'signing_secret', label: 'Signing Secret', type: 'password', required: true, hint: '获取方式：\n1. Slack API → 你的 App\n2. 点击 "Basic Information"\n3. 滚动到 "App Credentials"\n4. 复制 "Signing Secret"' },
    { name: 'app_token', label: 'App-Level Token', type: 'password', required: false, hint: '获取方式（如使用 Socket Mode）：\n1. Slack API → 你的 App\n2. 点击 "Basic Information"\n3. 点击 "Generate Token"（需要先添加 scope: connections:write）\n4. 复制以 xapp- 开头的 Token' }
  ],
  feishu: [
    { name: 'app_id', label: 'App ID (AppID)', type: 'text', required: true, hint: '获取方式：\n1. 打开 https://open.feishu.cn/app\n2. 创建或选择你的自建应用\n3. 点击 "凭证与基础信息"\n4. 复制 "App ID"' },
    { name: 'app_secret', label: 'App Secret (AppSecret)', type: 'password', required: true, hint: '获取方式：\n1. 飞书开放平台 → 你的应用\n2. 点击 "凭证与基础信息"\n3. 点击 "重置" 并复制 "App Secret"\n4. 需要在"版本管理与发布"中创建版本并发布' },
    { name: 'verification_token', label: 'Verification Token (订阅方式)', type: 'text', required: true, hint: '获取方式：\n1. 飞书应用 → 事件订阅\n2. 开启 "订阅" 按钮\n3. 在 "订阅方式" 中选择 "接收消息" 或 "回调模式"\n4. 复制 "Verification Token"' },
    { name: 'encrypt_key', label: 'Encrypt Key (可选)', type: 'password', required: false, hint: '获取方式：\n1. 飞书应用 → 事件订阅\n2. 开启 "Encrypt key"\n3. 复制生成的密钥' }
  ],
  dingtalk: [
    { name: 'agent_id', label: 'AgentId', type: 'text', required: true, hint: '获取方式：\n1. 登录钉钉管理后台 https://oa.dingtalk.com\n2. 点击 "应用管理" → "自建应用"\n3. 选择或创建应用\n4. 在应用详情页复制 "AgentId"' },
    { name: 'app_key', label: 'AppKey', type: 'text', required: true, hint: '获取方式：\n1. 钉钉开放平台 https://open.dingtalk.com\n2. 创建或选择企业内部应用\n3. 点击 "凭证与基础信息"\n4. 复制 "AppKey"' },
    { name: 'app_secret', label: 'AppSecret', type: 'password', required: true, hint: '获取方式：\n1. 钉钉开放平台 → 你的应用\n2. 点击 "凭证与基础信息"\n3. 点击 "查看" 或 "重置" 复制 "AppSecret"\n4. 需要在"权限管理"中添加所需API权限' }
  ],
  wechat_work: [
    { name: 'corp_id', label: '企业 ID (CorpID)', type: 'text', required: true, hint: '获取方式：\n1. 企业微信管理后台 https://work.weixin.qq.com\n2. 点击 "我的企业" → "企业信息"\n3. 复制 "企业ID"' },
    { name: 'agent_id', label: '应用 AgentId', type: 'text', required: true, hint: '获取方式：\n1. 企业微信 → "应用管理"\n2. 选择自建应用\n3. 在应用详情复制 "AgentId"' },
    { name: 'secret', label: '应用 Secret', type: 'password', required: true, hint: '获取方式：\n1. 企业微信 → 应用管理 → 你的应用\n2. 点击 "查看" 密码\n3. 复制 "Secret"\n4. 确保已在"API权限"中开通相关接口权限' }
  ],
  line: [
    { name: 'channel_access_token', label: 'Channel Access Token', type: 'password', required: true, hint: '获取方式：\n1. 访问 https://developers.line.biz/console\n2. 选择你的 Provider 和 Messaging API Channel\n3. 点击 "Messaging API" → "Channel access token"\n4. 点击 "Issue" 生成并复制 Token' },
    { name: 'channel_secret', label: 'Channel Secret', type: 'password', required: true, hint: '获取方式：\n1. LINE Developers Console → 你的 Channel\n2. 点击 "Basic settings"\n3. 复制 "Channel Secret"' }
  ]
};

// 认证中间件 - 支持 Authorization header 和 cookie
const authenticateToken = (req, res, next) => {
  let token = null;

  // 1. 尝试从 Authorization header 获取
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    token = authHeader.split(' ')[1];
  }

  // 2. 如果没有，尝试从 cookie 获取
  if (!token && req.headers['cookie']) {
    const cookies = req.headers['cookie'].split(';').reduce((acc, c) => {
      const [k, v] = c.trim().split('=');
      acc[k] = v;
      return acc;
    }, {});
    token = cookies['admin_token'];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: '未授权访问' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Token无效' });
    }
    req.user = user;
    next();
  });
};

// 记录审计日志
const logAudit = (adminId, action, targetType, targetId, detail, ip) => {
  db.prepare('INSERT INTO audit_logs (id, admin_id, action, target_type, target_id, detail, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    uuidv4(), adminId, action, targetType, targetId, JSON.stringify(detail), ip
  );
};

// 同步到OpenClaw配置
const syncToOpenClaw = async (userId) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return { success: false, message: '用户不存在' };

    const credentials = db.prepare('SELECT field_key, field_value FROM platform_credentials WHERE user_id = ?').all(userId);
    const credObj = {};
    credentials.forEach(c => { credObj[c.field_key] = c.field_value; });

    // 获取用户权限
    const permissions = db.prepare('SELECT * FROM user_permissions WHERE user_id = ?').get(userId);

    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.error('读取OpenClaw配置失败:', e.message);
    }

    if (!config.gateway) config.gateway = {};
    config.gateway.mode = config.gateway.mode || 'local';
    if (!config.gateway.http) config.gateway.http = {};
    if (!config.gateway.http.endpoints) config.gateway.http.endpoints = {};
    config.gateway.http.endpoints.chatCompletions = { enabled: true };
    if (!config.gateway.auth) config.gateway.auth = {};
    config.gateway.auth.token = GATEWAY_TOKEN;

    // 获取群组配置（管理员ID）
    const groupConfig = db.prepare('SELECT group_enabled, group_id FROM group_configs WHERE user_id = ?').get(userId);
    const groupEnabled = groupConfig && groupConfig.group_enabled;
    const groupId = groupConfig?.group_id;
    const canModifyServer = permissions?.perm_modify_server === 1;

    // 写入单独的权限配置文件
    const PERMISSIONS_CONFIG_PATH = '/home/ubuntu/.openclaw/permissions.json';
    const permissionsConfig = {
      groupSettings: {
        enabled: !!groupEnabled,
        adminIds: groupId || "",
        modifyServerEnabled: canModifyServer
      }
    };
    fs.writeFileSync(PERMISSIONS_CONFIG_PATH, JSON.stringify(permissionsConfig, null, 2));

    const platform = user.platform;
    if (platform) {
      const channelKey = platform === 'dingtalk' ? 'dingtalk-connector' :
                         platform === 'feishu' ? 'feishu' :
                         platform === 'wechat_work' ? 'wechat-work' : platform;
      if (!config.channels) config.channels = {};
      config.channels[channelKey] = config.channels[channelKey] || {};
      config.channels[channelKey].enabled = true;

      if (platform === 'dingtalk') {
        if (credObj.app_key) config.channels[channelKey].clientId = credObj.app_key;
        if (credObj.app_secret) config.channels[channelKey].clientSecret = credObj.app_secret;
        if (credObj.agent_id) config.channels[channelKey].agentId = credObj.agent_id;
      }
    }

    fs.writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2));

    // 自动为用户创建独立的 Stock Agent
    const agentScriptPath = '/home/ubuntu/stock-agent-project/create_user_agent.sh';
    if (fs.existsSync(agentScriptPath)) {
      try {
        const platform = user.platform;
        const username = user.username;
        const channelName = `${platform}-${username}`;

        // 检查是否已有同名 agent
        const agentId = `stock-${username}`;
        const { execSync } = require('child_process');
        const listResult = execSync('cd /home/ubuntu/openclaw && node openclaw.mjs agents list 2>/dev/null', { encoding: 'utf-8' });

        if (!listResult.includes(agentId)) {
          console.log(`[Agent创建] 为用户 ${username} 创建独立 Agent: ${agentId}`);
          execSync(`${agentScriptPath} ${username} ${channelName}`, {
            cwd: '/home/ubuntu/stock-agent-project',
            stdio: 'inherit'
          });
          console.log(`[Agent创建] 完成: ${agentId} -> ${channelName}`);
        } else {
          console.log(`[Agent创建] Agent ${agentId} 已存在，跳过创建`);
        }
      } catch (e) {
        console.error('[Agent创建] 创建失败:', e.message);
      }
    } else {
      console.log('[Agent创建] 脚本不存在，跳过');
    }

    try { execSync('pkill -f "openclaw-gat" 2>/dev/null || true', { stdio: 'ignore' }); } catch (e) {}
    try { execSync('cd /home/ubuntu/openclaw && nohup node dist/index.js gateway > /tmp/gateway.log 2>&1 &', { stdio: 'ignore' }); } catch (e) {}

    return { success: true, message: '已同步并重启Gateway' };
  } catch (error) {
    console.error('同步到OpenClaw失败:', error.message);
    return { success: false, message: error.message };
  }
};

// ============ API路由 ============

// 登录
app.post('/api/v1/auth/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);

  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return res.json({ success: false, message: '用户名或密码错误' });
  }

  db.prepare('UPDATE admins SET last_login = ? WHERE id = ?').run(new Date().toISOString(), admin.id);
  const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });

  logAudit(admin.id, 'login', 'admin', admin.id, { username }, req.ip);

  // 设置 cookie
  res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; HttpOnly; Max-Age=86400`);
  res.json({ success: true, data: { token, username: admin.username } });
});

// 获取当前管理员
app.get('/api/v1/auth/me', authenticateToken, (req, res) => {
  res.json({ success: true, data: { username: req.user.username } });
});

// 获取平台列表
app.get('/api/v1/platforms', (req, res) => {
  const platforms = Object.keys(platformFields).map(key => ({
    id: key,
    name: { telegram: 'Telegram', discord: 'Discord', slack: 'Slack', feishu: '飞书', dingtalk: '钉钉', wechat_work: '企业微信', line: 'LINE' }[key],
    status: 'supported'
  }));
  res.json({ success: true, data: platforms });
});

// 调试端点 - 检查收到的 headers
app.get('/api/v1/debug/headers', (req, res) => {
  res.json({
    success: true,
    data: {
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
      allHeaders: req.headers
    }
  });
});

// 获取平台字段
app.get('/api/v1/platforms/:platform/fields', (req, res) => {
  const fields = platformFields[req.params.platform];
  if (!fields) {
    return res.status(404).json({ success: false, message: '不支持的平台' });
  }
  res.json({ success: true, data: fields });
});

// 获取用户列表
app.get('/api/v1/users', authenticateToken, (req, res) => {
  const { search, platform, status, page = 1, limit = 20 } = req.query;
  let sql = 'SELECT id, username, display_name, platform, status, notes, created_at, last_active_at FROM users WHERE 1=1';
  const params = [];

  if (search) {
    sql += ' AND (username LIKE ? OR display_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (platform) {
    sql += ' AND platform = ?';
    params.push(platform);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  const offset = (parseInt(page) - 1) * parseInt(limit);
  params.push(parseInt(limit), offset);

  const users = db.prepare(sql).all(...params);
  const countSql = sql.replace(/SELECT .* FROM users/, 'SELECT COUNT(*) as total FROM users').split('LIMIT')[0];
  const total = db.prepare(countSql).get(...params.slice(0, -2)).total;

  res.json({ success: true, data: { users, total, page: parseInt(page), limit: parseInt(limit) } });
});

// 创建用户
app.post('/api/v1/users', authenticateToken, async (req, res) => {
  const { username, display_name, platform, notes, credentials, permissions } = req.body;

  if (!username || !platform) {
    return res.json({ success: false, message: '缺少必要字段' });
  }

  const userId = uuidv4();

  try {
    db.prepare('INSERT INTO users (id, username, display_name, platform, notes) VALUES (?, ?, ?, ?, ?)').run(
      userId, username, display_name || username, platform, notes || ''
    );

    // 添加凭证
    if (credentials) {
      const insertCred = db.prepare('INSERT INTO platform_credentials (id, user_id, platform, field_key, field_value) VALUES (?, ?, ?, ?, ?)');
      Object.entries(credentials).forEach(([key, value]) => {
        insertCred.run(uuidv4(), userId, platform, key, value);
      });
    }

    // 添加权限
    const permId = uuidv4();
    db.prepare(`INSERT INTO user_permissions (id, user_id, perm_send_message, perm_receive_message, perm_call_claude_code,
      perm_modify_server, perm_upload_file, perm_view_logs, rate_daily_messages, rate_max_file_size_mb, rate_max_concurrent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      permId, userId,
      permissions?.perm_send_message !== false ? 1 : 0,
      permissions?.perm_receive_message !== false ? 1 : 0,
      permissions?.perm_call_claude_code ? 1 : 0,
      permissions?.perm_modify_server ? 1 : 0,
      permissions?.perm_upload_file !== false ? 1 : 0,
      permissions?.perm_view_logs !== false ? 1 : 0,
      permissions?.rate_daily_messages || 0,
      permissions?.rate_max_file_size_mb || 10,
      permissions?.rate_max_concurrent || 5
    );

    // 添加群组配置
    db.prepare('INSERT INTO group_configs (id, user_id) VALUES (?, ?)').run(uuidv4(), userId);

    logAudit(req.user.id, 'create_user', 'user', userId, { username, platform }, req.ip);

    // 同步到OpenClaw
    const syncResult = await syncToOpenClaw(userId);

    res.json({ success: true, data: { id: userId }, sync: syncResult });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 获取用户详情
app.get('/api/v1/users/:id', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  const credentials = db.prepare('SELECT field_key, field_value FROM platform_credentials WHERE user_id = ?').all(req.params.id);
  // 返回键值对对象
  user.credentials = credentials.reduce((obj, c) => { obj[c.field_key] = c.field_value; return obj; }, {});
  user.credentials_masked = credentials.map(c => ({ key: c.field_key, value: '******' }));

  const permissions = db.prepare('SELECT * FROM user_permissions WHERE user_id = ?').get(req.params.id);
  user.permissions = permissions;

  const groupConfig = db.prepare('SELECT * FROM group_configs WHERE user_id = ?').get(req.params.id);
  if (groupConfig) {
    const admins = db.prepare('SELECT * FROM group_admins WHERE group_config_id = ?').all(groupConfig.id);
    user.group_config = { ...groupConfig, admins };
  }

  res.json({ success: true, data: user });
});

// 更新用户
app.put('/api/v1/users/:id', authenticateToken, async (req, res) => {
  const { username, display_name, notes, platform, credentials } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  // 更新用户基本信息
  db.prepare('UPDATE users SET username = ?, display_name = ?, notes = ?, platform = ?, updated_at = ? WHERE id = ?').run(
    username || user.username,
    display_name || user.display_name,
    notes || user.notes,
    platform || user.platform,
    new Date().toISOString(),
    req.params.id
  );

  // 更新凭证
  if (credentials && typeof credentials === 'object') {
    // 删除旧凭证
    db.prepare('DELETE FROM platform_credentials WHERE user_id = ?').run(req.params.id);
    // 添加新凭证 - 使用更新后的 platform
    const currentPlatform = platform || user.platform;
    const insert = db.prepare('INSERT INTO platform_credentials (id, user_id, platform, field_key, field_value, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [key, value] of Object.entries(credentials)) {
      if (value) {
        insert.run(uuidv4(), req.params.id, currentPlatform, key, value, new Date().toISOString());
      }
    }
  }

  logAudit(req.user.id, 'update_user', 'user', req.params.id, req.body, req.ip);

  // 同步到OpenClaw
  const syncResult = await syncToOpenClaw(req.params.id);

  res.json({ success: true, sync: syncResult });
});

// 删除用户
app.delete('/api/v1/users/:id', authenticateToken, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logAudit(req.user.id, 'delete_user', 'user', req.params.id, {}, req.ip);
  res.json({ success: true });
});

// 更新用户状态
app.patch('/api/v1/users/:id/status', authenticateToken, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), req.params.id);
  logAudit(req.user.id, 'update_status', 'user', req.params.id, { status }, req.ip);
  syncToOpenClaw(req.params.id);
  res.json({ success: true });
});

// 获取凭证
app.get('/api/v1/users/:id/credentials', authenticateToken, (req, res) => {
  const credentials = db.prepare('SELECT field_key, field_value FROM platform_credentials WHERE user_id = ?').all(req.params.id);
  const masked = credentials.map(c => ({ key: c.field_key, value: '******' }));
  res.json({ success: true, data: masked });
});

// 更新凭证
app.put('/api/v1/users/:id/credentials', authenticateToken, (req, res) => {
  const { credentials } = req.body;
  const user = db.prepare('SELECT platform FROM users WHERE id = ?').get(req.params.id);

  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  const deleteStmt = db.prepare('DELETE FROM platform_credentials WHERE user_id = ? AND field_key = ?');
  const insertStmt = db.prepare('INSERT OR REPLACE INTO platform_credentials (id, user_id, platform, field_key, field_value, updated_at) VALUES (?, ?, ?, ?, ?, ?)');

  Object.entries(credentials).forEach(([key, value]) => {
    deleteStmt.run(req.params.id, key);
    insertStmt.run(uuidv4(), req.params.id, user.platform, key, value, new Date().toISOString());
  });

  logAudit(req.user.id, 'update_credentials', 'user', req.params.id, { fields: Object.keys(credentials) }, req.ip);
  syncToOpenClaw(req.params.id);

  res.json({ success: true });
});

// 获取权限
app.get('/api/v1/users/:id/permissions', authenticateToken, (req, res) => {
  const permissions = db.prepare('SELECT * FROM user_permissions WHERE user_id = ?').get(req.params.id);
  res.json({ success: true, data: permissions || {} });
});

// 更新权限
app.put('/api/v1/users/:id/permissions', authenticateToken, (req, res) => {
  // 支持嵌套结构 { permissions: {...} } 和扁平结构 { perm_send_message: true, ... }
  let permissions = req.body.permissions || req.body;
  const userId = req.params.id;

  const existing = db.prepare('SELECT id FROM user_permissions WHERE user_id = ?').get(userId);

  if (existing) {
    db.prepare(`UPDATE user_permissions SET
      perm_send_message = ?, perm_receive_message = ?, perm_call_claude_code = ?,
      perm_modify_server = ?, perm_upload_file = ?, perm_view_logs = ?,
      rate_daily_messages = ?, rate_max_file_size_mb = ?, rate_max_concurrent = ?,
      updated_at = ? WHERE user_id = ?`).run(
      permissions.perm_send_message ? 1 : 0, permissions.perm_receive_message ? 1 : 0, permissions.perm_call_claude_code ? 1 : 0,
      permissions.perm_modify_server ? 1 : 0, permissions.perm_upload_file ? 1 : 0, permissions.perm_view_logs ? 1 : 0,
      permissions.rate_daily_messages || 0, permissions.rate_max_file_size_mb || 10, permissions.rate_max_concurrent || 5,
      new Date().toISOString(), userId
    );
  } else {
    db.prepare(`INSERT INTO user_permissions (id, user_id, perm_send_message, perm_receive_message, perm_call_claude_code,
      perm_modify_server, perm_upload_file, perm_view_logs, rate_daily_messages, rate_max_file_size_mb, rate_max_concurrent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv4(), userId,
      permissions.perm_send_message ? 1 : 0, permissions.perm_receive_message ? 1 : 0, permissions.perm_call_claude_code ? 1 : 0,
      permissions.perm_modify_server ? 1 : 0, permissions.perm_upload_file ? 1 : 0, permissions.perm_view_logs ? 1 : 0,
      permissions.rate_daily_messages || 0, permissions.rate_max_file_size_mb || 10, permissions.rate_max_concurrent || 5
    );
  }

  logAudit(req.user.id, 'update_permissions', 'user', userId, permissions, req.ip);
  syncToOpenClaw(userId);

  res.json({ success: true });
});

// 获取群组配置
app.get('/api/v1/users/:id/group-config', authenticateToken, (req, res) => {
  const config = db.prepare('SELECT * FROM group_configs WHERE user_id = ?').get(req.params.id);
  if (config) {
    config.admins = db.prepare('SELECT * FROM group_admins WHERE group_config_id = ?').all(config.id);
  }
  res.json({ success: true, data: config || {} });
});

// 更新群组配置
app.put('/api/v1/users/:id/group-config', authenticateToken, (req, res) => {
  const { group_enabled, group_id } = req.body;
  const userId = req.params.id;

  const existing = db.prepare('SELECT id FROM group_configs WHERE user_id = ?').get(userId);

  if (existing) {
    db.prepare('UPDATE group_configs SET group_enabled = ?, group_id = ?, updated_at = ? WHERE user_id = ?').run(
      group_enabled ? 1 : 0, group_id || '', new Date().toISOString(), userId
    );
  } else {
    db.prepare('INSERT INTO group_configs (id, user_id, group_enabled, group_id) VALUES (?, ?, ?, ?)').run(
      uuidv4(), userId, group_enabled ? 1 : 0, group_id || ''
    );
  }

  logAudit(req.user.id, 'update_group_config', 'user', userId, { group_enabled, group_id }, req.ip);
  syncToOpenClaw(userId);

  res.json({ success: true });
});

// 添加群管理员
app.post('/api/v1/users/:id/group-admins', authenticateToken, (req, res) => {
  const { admin_name, admin_id } = req.body;
  const userId = req.params.id;

  const config = db.prepare('SELECT id FROM group_configs WHERE user_id = ?').get(userId);
  if (!config) {
    return res.status(404).json({ success: false, message: '群组配置不存在' });
  }

  const adminId = uuidv4();
  db.prepare('INSERT INTO group_admins (id, group_config_id, admin_name, admin_id) VALUES (?, ?, ?, ?)').run(
    adminId, config.id, admin_name, admin_id || ''
  );

  logAudit(req.user.id, 'add_group_admin', 'user', userId, { admin_name, admin_id }, req.ip);
  syncToOpenClaw(userId);

  res.json({ success: true, data: { id: adminId } });
});

// 删除群管理员
app.delete('/api/v1/users/:id/group-admins/:adminId', authenticateToken, (req, res) => {
  db.prepare('DELETE FROM group_admins WHERE id = ?').run(req.params.adminId);
  logAudit(req.user.id, 'delete_group_admin', 'user', req.params.id, { adminId: req.params.adminId }, req.ip);
  syncToOpenClaw(req.params.id);
  res.json({ success: true });
});

// 仪表盘统计
app.get('/api/v1/dashboard/stats', authenticateToken, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as total FROM users').get().total;
  const activeUsers = db.prepare("SELECT COUNT(*) as total FROM users WHERE status = 'active'").get().total;

  const platformStats = db.prepare('SELECT platform, COUNT(*) as count FROM users GROUP BY platform').all();

  const today = new Date().toISOString().split('T')[0];
  const todayLogs = db.prepare('SELECT COUNT(*) as total FROM audit_logs WHERE created_at LIKE ?').get(`${today}%`).total;

  res.json({
    success: true,
    data: {
      total_users: totalUsers,
      active_users: activeUsers,
      platform_stats: platformStats,
      today_operations: todayLogs
    }
  });
});

// 仪表盘日志
app.get('/api/v1/dashboard/logs', authenticateToken, (req, res) => {
  const logs = db.prepare(`
    SELECT al.*, a.username as admin_username
    FROM audit_logs al
    LEFT JOIN admins a ON al.admin_id = a.id
    ORDER BY al.created_at DESC
    LIMIT 50
  `).all();
  res.json({ success: true, data: logs });
});

// 审计日志
app.get('/api/v1/audit-logs', authenticateToken, (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const logs = db.prepare(`
    SELECT al.*, a.username as admin_username
    FROM audit_logs al
    LEFT JOIN admins a ON al.admin_id = a.id
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `).all(parseInt(limit), offset);

  const total = db.prepare('SELECT COUNT(*) as total FROM audit_logs').get().total;

  res.json({ success: true, data: { logs, total, page: parseInt(page), limit: parseInt(limit) } });
});

// OpenClaw状态
app.get('/api/v1/openclaw/status', authenticateToken, (req, res) => {
  res.json({ success: true, data: { connected: true, webhook_url: OPENCLAW_WEBHOOK_URL } });
});

// 手动同步
app.post('/api/v1/openclaw/sync/:userId', authenticateToken, async (req, res) => {
  const success = await syncToOpenClaw(req.params.userId);
  res.json({ success, message: success ? '同步成功' : '同步失败' });
});

// 前端页面路由
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/', (req, res) => {
  res.redirect('/admin');
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenClaw Admin 服务已启动: http://0.0.0.0:${PORT}`);
  console.log(`OpenClaw Webhook URL: ${OPENCLAW_WEBHOOK_URL}`);
});
