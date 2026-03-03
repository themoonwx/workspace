const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;

// ==================== 数据库初始化 ====================
const Database = require('better-sqlite3');
const dbPath = path.join(__dirname, 'data.db');
let db;

// 初始化数据库
function initDatabase() {
    try {
        db = new Database(dbPath);
        console.log('数据库连接成功:', dbPath);

        // 创建用户表
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                tenantId TEXT,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 创建租户表
        db.exec(`
            CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                plan TEXT DEFAULT 'basic',
                maxUsers INTEGER DEFAULT 10,
                features TEXT DEFAULT '[]',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 创建平台配置表
        db.exec(`
            CREATE TABLE IF NOT EXISTS platform_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenantId TEXT NOT NULL,
                platform TEXT NOT NULL,
                config TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenantId) REFERENCES tenants(id)
            )
        `);

        // 创建权限表
        db.exec(`
            CREATE TABLE IF NOT EXISTS permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL,
                permission TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (userId) REFERENCES users(id)
            )
        `);

        // 如果数据库为空，导入初始数据
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
        if (userCount.count === 0) {
            console.log('导入初始数据...');
            importInitialData();
        }

        console.log('数据库初始化完成');
    } catch (error) {
        console.error('数据库初始化失败:', error);
        process.exit(1);
    }
}

// 导入初始数据
function importInitialData() {
    // 导入租户
    const insertTenant = db.prepare('INSERT INTO tenants (id, name, plan, maxUsers, features) VALUES (?, ?, ?, ?, ?)');
    insertTenant.run('tenant-001', '示例公司', 'enterprise', 100, JSON.stringify(['analytics', 'api', 'customDomain']));
    insertTenant.run('tenant-002', '租户二公司', 'basic', 10, JSON.stringify(['analytics']));

    // 导入用户
    const insertUser = db.prepare('INSERT INTO users (username, password, name, role, tenantId) VALUES (?, ?, ?, ?, ?)');
    insertUser.run('admin', '123456', '管理员', 'admin', 'tenant-001');
    insertUser.run('user', '123456', '普通用户', 'user', 'tenant-001');
    insertUser.run('tenant2', '123456', '租户2用户', 'user', 'tenant-002');
    insertUser.run('test1', '123456', '测试用户1', 'user', 'tenant-001');
    insertUser.run('test2', '123456', '测试用户2', 'user', 'tenant-001');

    // 导入权限
    const insertPermission = db.prepare('INSERT INTO permissions (userId, permission) VALUES (?, ?)');
    insertPermission.run(1, 'modify_config');
    insertPermission.run(1, 'call_claude');
    insertPermission.run(1, 'send_message');
    insertPermission.run(1, 'receive_message');
    insertPermission.run(2, 'send_message');
    insertPermission.run(2, 'receive_message');
}

// 数据库查询辅助函数
function getUsers(tenantId) {
    return db.prepare('SELECT id, username, name, role, tenantId FROM users WHERE tenantId = ?').all(tenantId);
}

function getUserById(userId) {
    return db.prepare('SELECT id, username, name, role, tenantId FROM users WHERE id = ?').get(userId);
}

function getTenant(tenantId) {
    return db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
}

function getTenants() {
    return db.prepare('SELECT * FROM tenants').all();
}

function getPlatformConfigs(tenantId) {
    const configs = db.prepare('SELECT * FROM platform_configs WHERE tenantId = ?').all(tenantId);
    return configs.map(c => ({ ...c, config: JSON.parse(c.config), enabled: !!c.enabled }));
}

function savePlatformConfig(tenantId, platform, config) {
    const existing = db.prepare('SELECT id FROM platform_configs WHERE tenantId = ? AND platform = ?').get(tenantId, platform);
    if (existing) {
        db.prepare('UPDATE platform_configs SET config = ?, updatedAt = CURRENT_TIMESTAMP WHERE tenantId = ? AND platform = ?')
            .run(JSON.stringify(config), tenantId, platform);
    } else {
        db.prepare('INSERT INTO platform_configs (tenantId, platform, config) VALUES (?, ?, ?)')
            .run(tenantId, platform, JSON.stringify(config));
    }
}

function deletePlatformConfig(tenantId, platform) {
    db.prepare('DELETE FROM platform_configs WHERE tenantId = ? AND platform = ?').run(tenantId, platform);
}

function getPermissions(userId) {
    return db.prepare('SELECT permission FROM permissions WHERE userId = ?').all(userId).map(p => p.permission);
}

function setPermissions(userId, permissions) {
    db.prepare('DELETE FROM permissions WHERE userId = ?').run(userId);
    const insert = db.prepare('INSERT INTO permissions (userId, permission) VALUES (?, ?)');
    for (const perm of permissions) {
        insert.run(userId, perm);
    }
}

// 平台配置定义
const PLATFORM_CONFIGS = {
    discord: {
        name: 'Discord',
        icon: '💬',
        fields: [
            { key: 'token', label: 'Bot Token', type: 'password', required: true, placeholder: 'MTAx...',
              help: '在 Discord Developer Portal 创建应用后获取 Bot Token' },
            { key: 'name', label: 'Bot名称', type: 'text', required: false, placeholder: 'OpenClaw Bot' }
        ],
        instructions: `
            获取 Discord Bot Token:
            1. 访问 https://discord.com/developers/applications
            2. 创建新应用 → Bot → Reset Token
            3. 启用 MESSAGE CONTENT INTENT
            4. 生成邀请链接: OAuth2 → URL Generator → bot 权限
        `
    },
    telegram: {
        name: 'Telegram',
        icon: '✈️',
        fields: [
            { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
              help: '通过 @BotFather 创建机器人获取' }
        ],
        instructions: `
            获取 Telegram Bot Token:
            1. 在 Telegram 中搜索 @BotFather
            2. 发送 /newbot 创建新机器人
            3. 按提示设置名称和用户名
            4. 获取 Bot Token
        `
    },
    slack: {
        name: 'Slack',
        icon: '💼',
        fields: [
            { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: 'xoxb-...',
              help: '在 Slack App 设置中获取' },
            { key: 'signingSecret', label: 'Signing Secret', type: 'password', required: true, placeholder: '...',
              help: '在 Slack App 的 Basic Information 中获取' },
            { key: 'appToken', label: 'App Token', type: 'password', required: false, placeholder: 'xapp-...',
              help: '如果使用 Socket Mode，需要获取 App Token' }
        ],
        instructions: `
            获取 Slack 配置:
            1. 访问 https://api.slack.com/apps
            2. 创建新 App (From scratch)
            3. 在 OAuth & Permissions 添加 scopes: chat:write, channels:read, im:read 等
            4. 安装到工作区获取 Bot Token
            5. 在 Basic Information 获取 Signing Secret
        `
    },
    feishu: {
        name: '飞书',
        icon: '📱',
        fields: [
            { key: 'appId', label: 'App ID', type: 'text', required: true, placeholder: 'cli_xxxxx',
              help: '在飞书开放平台应用设置中获取' },
            { key: 'appSecret', label: 'App Secret', type: 'password', required: true, placeholder: '...',
              help: '在飞书开放平台应用设置中获取' },
            { key: 'encryptKey', label: 'Encrypt Key', type: 'password', required: false, placeholder: '...',
              help: '可选，用于验证请求真实性' },
            { key: 'verificationToken', label: 'Verification Token', type: 'password', required: false, placeholder: '...',
              help: '用于接收事件回调验证' },
            { key: 'domain', label: '域名', type: 'select', options: ['feishu', 'lark'], required: false }
        ],
        instructions: `
            获取飞书配置:
            1. 访问 https://open.feishu.cn/app
            2. 创建企业自建应用
            3. 在应用设置中获取 App ID 和 App Secret
            4. 添加权限: im.chat, im.message, contact:user.basecard 等
            5. 创建版本并发布
        `
    },
    dingtalk: {
        name: '钉钉',
        icon: '🔔',
        fields: [
            { key: 'agentId', label: 'Agent ID', type: 'text', required: true, placeholder: '...',
              help: '在钉钉开放平台应用详情中获取' },
            { key: 'appKey', label: 'App Key', type: 'text', required: true, placeholder: 'ding...',
              help: '在钉钉开放平台应用凭证中获取' },
            { key: 'appSecret', label: 'App Secret', type: 'password', required: true, placeholder: '...',
              help: '在钉钉开放平台应用凭证中获取' }
        ],
        instructions: `
            获取钉钉配置:
            1. 访问 https://open.dingtalk.com
            2. 创建企业自建应用
            3. 在应用详情获取 Agent ID
            4. 在应用凭证获取 App Key 和 App Secret
            5. 添加 API 权限: 群消息、发送工作通知等
        `
    },
    wecom: {
        name: '企业微信',
        icon: '💼',
        fields: [
            { key: 'corpId', label: 'Corp ID', type: 'text', required: true, placeholder: 'ww...',
              help: '在企业微信管理后台获取' },
            { key: 'corpSecret', label: 'Corp Secret', type: 'password', required: true, placeholder: '...',
              help: '在企业微信管理后台-应用管理中获取' },
            { key: 'agentId', label: 'Agent ID', type: 'text', required: true, placeholder: '...',
              help: '在企业微信应用管理中获取' }
        ],
        instructions: `
            获取企业微信配置:
            1. 访问 https://work.weixin.qq.com
            2. 创建自建应用
            3. 在应用管理获取 Agent ID
            4. 在我的企业获取 Corp ID
            5. 在应用管理获取 Corp Secret
        `
    },
    line: {
        name: 'LINE',
        icon: '📱',
        fields: [
            { key: 'channelAccessToken', label: 'Channel Access Token', type: 'password', required: true, placeholder: '...',
              help: '在 LINE Developers Console 获取' },
            { key: 'channelSecret', label: 'Channel Secret', type: 'password', required: true, placeholder: '...',
              help: '在 LINE Developers Console 获取' }
        ],
        instructions: `
            获取 LINE 配置:
            1. 访问 https://developers.line.biz
            2. 创建 Provider 和 Channel
            3. 在 Messaging API 设置中获取 Channel Access Token
            4. 在 Basic Settings 获取 Channel Secret
            5. 启用 Webhook
        `
    }
};

// 权限定义
const PERMISSIONS = [
    { key: 'modify_config', name: '修改服务器配置', description: '可以修改租户的服务器配置' },
    { key: 'call_claude', name: '调用Claude Code', description: '可以通过AI进行对话' },
    { key: 'send_message', name: '发送消息', description: '可以通过社交平台发送消息' },
    { key: 'receive_message', name: '接收消息', description: '可以接收来自社交平台的消息' }
];

// 模拟用户数据（实际项目中应该从数据库获取）
const users = [
    { id: 1, username: 'admin', password: '123456', name: '管理员', role: 'admin', tenantId: 'tenant-001' },
    { id: 2, username: 'user', password: '123456', name: '普通用户', role: 'user', tenantId: 'tenant-001' },
    { id: 3, username: 'tenant2', password: '123456', name: '租户2用户', role: 'user', tenantId: 'tenant-002' },
    { id: 4, username: 'test1', password: '123456', name: '测试用户1', role: 'user', tenantId: 'tenant-001' },
    { id: 5, username: 'test2', password: '123456', name: '测试用户2', role: 'user', tenantId: 'tenant-001' }
];

// 模拟租户数据
const tenants = {
    'tenant-001': {
        id: 'tenant-001',
        name: '示例公司',
        plan: 'enterprise',
        maxUsers: 100,
        features: ['analytics', 'api', 'customDomain']
    },
    'tenant-002': {
        id: 'tenant-002',
        name: '租户二公司',
        plan: 'basic',
        maxUsers: 10,
        features: ['analytics']
    }
};

// Discord 配置 (版本 2026.3.1 新增)
const discordConfig = {
    threadBinding: {
        enabled: true,
        idleHours: 24,      // 空闲超时时间（小时）
        maxAge: 168,        // 最大存活时间（小时），默认7天
        autoUnbind: true    // 超时后自动解绑
    }
};

// Telegram 配置 (版本 2026.3.1 新增)
const telegramConfig = {
    dmTopics: {
        enabled: true,
        permissions: {}      // 按话题配置权限，格式: { topicId: { allow: [], deny: [] } }
    }
};

// 解析请求体
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

// API 路由处理
async function handleApi(req, res) {
    const url = req.url.split('?')[0];
    const method = req.method;

    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    res.setHeader('Content-Type', 'application/json');

    try {
        // 登录 API
        if (url === '/api/login' && method === 'POST') {
            const { username, password } = await parseBody(req);

            // 从数据库查询用户
            const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);

            if (user) {
                // 返回 token 和用户信息
                const token = Buffer.from(`${user.id}:${user.tenantId}`).toString('base64');
                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        name: user.name,
                        role: user.role,
                        tenantId: user.tenantId
                    }
                }));
            } else {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '用户名或密码错误' }));
            }
            return;
        }

        // 获取平台配置定义 API
        if (url === '/api/platforms' && method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({
                success: true,
                platforms: PLATFORM_CONFIGS,
                permissions: PERMISSIONS
            }));
            return;
        }

        // 获取租户的平台配置 API
        if (url === '/api/tenant/platforms' && method === 'GET') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');

                const configs = getPlatformConfigs(tenantId);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, configs }));
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // 保存租户平台配置 API
        if (url === '/api/tenant/platforms' && method === 'POST') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');

                // 检查权限
                const userPerms = getPermissions(parseInt(userId));
                if (!userPerms.includes('modify_config')) {
                    res.writeHead(403);
                    res.end(JSON.stringify({ success: false, message: '没有修改配置的权限' }));
                    return;
                }

                const body = await parseBody(req);
                const { platform, config, enabled } = body;

                if (!platform || !config) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, message: '平台和配置不能为空' }));
                    return;
                }

                savePlatformConfig(tenantId, platform, config);

                // 如果需要禁用
                if (enabled === false) {
                    db.prepare('UPDATE platform_configs SET enabled = 0 WHERE tenantId = ? AND platform = ?')
                        .run(tenantId, platform);
                }

                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: '配置保存成功' }));
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // 删除租户平台配置 API
        if (url.startsWith('/api/tenant/platforms/') && method === 'DELETE') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');

                // 检查权限
                const userPerms = getPermissions(parseInt(userId));
                if (!userPerms.includes('modify_config')) {
                    res.writeHead(403);
                    res.end(JSON.stringify({ success: false, message: '没有修改配置的权限' }));
                    return;
                }

                const platform = url.replace('/api/tenant/platforms/', '');
                deletePlatformConfig(tenantId, platform);

                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: '配置删除成功' }));
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // 获取用户权限 API
        if (url.startsWith('/api/permissions/') && method === 'GET') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');

                const targetUserId = url.replace('/api/permissions/', '');
                const permissions = getPermissions(parseInt(targetUserId));

                res.writeHead(200);
                res.end(JSON.stringify({ success: true, permissions }));
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // 更新用户权限 API
        if (url.startsWith('/api/permissions/') && method === 'POST') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');

                // 检查是否是管理员
                const currentUser = getUserById(parseInt(userId));
                if (!currentUser || currentUser.role !== 'admin') {
                    res.writeHead(403);
                    res.end(JSON.stringify({ success: false, message: '只有管理员才能管理权限' }));
                    return;
                }

                const targetUserId = url.replace('/api/permissions/', '');
                const body = await parseBody(req);
                const { permissions } = body;

                setPermissions(parseInt(targetUserId), permissions || []);

                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: '权限更新成功' }));
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // 获取当前用户信息 API
        if (url === '/api/user' && method === 'GET') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');
                const user = getUserById(parseInt(userId));

                if (user) {
                    // 获取用户权限
                    const permissions = getPermissions(user.id);
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: true,
                        user: {
                            id: user.id,
                            username: user.username,
                            name: user.name,
                            role: user.role,
                            tenantId: user.tenantId,
                            permissions: permissions
                        }
                    }));
                } else {
                    res.writeHead(401);
                    res.end(JSON.stringify({ success: false, message: '用户不存在' }));
                }
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // 获取租户信息 API (多租户系统核心)
        if (url === '/api/tenant' && method === 'GET') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');
                const tenant = getTenant(tenantId);

                if (tenant) {
                    // 获取平台配置
                    const configs = getPlatformConfigs(tenantId);
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: true,
                        tenant: {
                            ...tenant,
                            features: JSON.parse(tenant.features || '[]'),
                            platformConfigs: configs
                        }
                    }));
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ success: false, message: '租户不存在' }));
                }
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // 获取用户列表 API (根据租户过滤)
        if (url === '/api/users' && method === 'GET') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');

                // 获取当前租户的所有用户
                const tenantUsers = getUsers(tenantId);

                // 获取每个用户的权限
                const usersWithPerms = tenantUsers.map(u => ({
                    ...u,
                    permissions: getPermissions(u.id)
                }));

                res.writeHead(200);
                res.end(JSON.stringify({ success: true, users: usersWithPerms }));
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // Discord 配置 API (版本 2026.3.1 新增)
        // 获取 Discord 配置
        if (url === '/api/discord/config' && method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, config: discordConfig }));
            return;
        }

        // 更新 Discord 线程绑定配置
        if (url === '/api/discord/config' && method === 'POST') {
            const body = await parseBody(req);
            const { idleHours, maxAge, autoUnbind, enabled } = body;

            if (idleHours !== undefined) discordConfig.threadBinding.idleHours = idleHours;
            if (maxAge !== undefined) discordConfig.threadBinding.maxAge = maxAge;
            if (autoUnbind !== undefined) discordConfig.threadBinding.autoUnbind = autoUnbind;
            if (enabled !== undefined) discordConfig.threadBinding.enabled = enabled;

            res.writeHead(200);
            res.end(JSON.stringify({ success: true, config: discordConfig }));
            return;
        }

        // Telegram 配置 API (版本 2026.3.1 新增)
        // 获取 Telegram 配置
        if (url === '/api/telegram/config' && method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, config: telegramConfig }));
            return;
        }

        // 更新 Telegram DM 话题权限配置
        if (url === '/api/telegram/config' && method === 'POST') {
            const body = await parseBody(req);
            const { enabled, permissions } = body;

            if (enabled !== undefined) telegramConfig.dmTopics.enabled = enabled;
            if (permissions !== undefined) telegramConfig.dmTopics.permissions = permissions;

            res.writeHead(200);
            res.end(JSON.stringify({ success: true, config: telegramConfig }));
            return;
        }

        // 配置单个话题权限
        if (url.startsWith('/api/telegram/topic/') && method === 'POST') {
            const topicId = url.replace('/api/telegram/topic/', '');
            const body = await parseBody(req);
            const { allow, deny } = body;

            telegramConfig.dmTopics.permissions[topicId] = { allow, deny };

            res.writeHead(200);
            res.end(JSON.stringify({ success: true, topicId, permissions: telegramConfig.dmTopics.permissions[topicId] }));
            return;
        }

        // 获取单个话题权限
        if (url.startsWith('/api/telegram/topic/') && method === 'GET') {
            const topicId = url.replace('/api/telegram/topic/', '');
            const permissions = telegramConfig.dmTopics.permissions[topicId] || { allow: [], deny: [] };

            res.writeHead(200);
            res.end(JSON.stringify({ success: true, topicId, permissions }));
            return;
        }

        // 添加租户 API (仅管理员可用)
        if (url === '/api/tenant/add' && method === 'POST') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');
                const currentUser = getUserById(parseInt(userId));

                // 检查是否是管理员
                if (!currentUser || currentUser.role !== 'admin') {
                    res.writeHead(403);
                    res.end(JSON.stringify({ success: false, message: '只有管理员才能添加租户' }));
                    return;
                }

                const body = await parseBody(req);
                const { name, plan, maxUsers, platformConfigs } = body;

                if (!name) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, message: '租户名称不能为空' }));
                    return;
                }

                // 生成新租户ID
                const newTenantId = 'tenant-' + Date.now();

                // 保存租户到数据库
                const features = plan === 'enterprise' ? JSON.stringify(['analytics', 'api', 'customDomain']) : JSON.stringify(['analytics']);
                db.prepare('INSERT INTO tenants (id, name, plan, maxUsers, features) VALUES (?, ?, ?, ?, ?)')
                    .run(newTenantId, name, plan || 'basic', maxUsers || 10, features);

                // 保存平台配置
                if (platformConfigs && Array.isArray(platformConfigs)) {
                    for (const config of platformConfigs) {
                        if (config.platform && config.config) {
                            savePlatformConfig(newTenantId, config.platform, config.config);
                        }
                    }
                }

                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    message: '租户添加成功',
                    tenant: {
                        id: newTenantId,
                        name: name,
                        plan: plan || 'basic',
                        maxUsers: maxUsers || 10,
                        features: JSON.parse(features)
                    }
                }));
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // 更新租户 API (仅管理员可用)
        if (url === '/api/tenant/update' && method === 'POST') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');
                const currentUser = getUserById(parseInt(userId));

                // 检查是否是管理员
                if (!currentUser || currentUser.role !== 'admin') {
                    res.writeHead(403);
                    res.end(JSON.stringify({ success: false, message: '只有管理员才能更新租户' }));
                    return;
                }

                const body = await parseBody(req);
                const { id, name, plan, maxUsers } = body;

                if (!id || !name) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, message: '租户ID和名称不能为空' }));
                    return;
                }

                // 检查租户是否存在
                const existingTenant = getTenant(id);
                if (!existingTenant) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ success: false, message: '租户不存在' }));
                    return;
                }

                // 更新租户信息到数据库
                const newPlan = plan || existingTenant.plan || 'basic';
                const newMaxUsers = maxUsers || existingTenant.maxUsers || 10;
                const features = newPlan === 'enterprise' ? JSON.stringify(['analytics', 'api', 'customDomain']) : JSON.stringify(['analytics']);

                db.prepare('UPDATE tenants SET name = ?, plan = ?, maxUsers = ?, features = ? WHERE id = ?')
                    .run(name, newPlan, newMaxUsers, features, id);

                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    message: '租户更新成功',
                    tenant: {
                        id,
                        name,
                        plan: newPlan,
                        maxUsers: newMaxUsers,
                        features: JSON.parse(features)
                    }
                }));
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // 获取所有租户列表 API (仅管理员)
        if (url === '/api/tenants' && method === 'GET') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '未授权' }));
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                const [userId, tenantId] = decoded.split(':');
                const currentUser = getUserById(parseInt(userId));

                // 检查是否是管理员
                if (!currentUser || currentUser.role !== 'admin') {
                    res.writeHead(403);
                    res.end(JSON.stringify({ success: false, message: '只有管理员才能查看所有租户' }));
                    return;
                }

                // 从数据库获取所有租户
                const tenantList = getTenants().map(t => ({
                    ...t,
                    features: JSON.parse(t.features || '[]')
                }));
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, tenants: tenantList }));
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
            return;
        }

        // 其他 API 返回 404
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'API 不存在' }));

    } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, message: '服务器错误: ' + error.message }));
    }
}

const loginPage = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录 - 测试系统</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .login-container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            padding: 40px;
            width: 100%;
            max-width: 400px;
        }
        .login-header {
            text-align: center;
            margin-bottom: 30px;
        }
        .login-header h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 8px;
        }
        .login-header p {
            color: #666;
            font-size: 14px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            color: #333;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 8px;
        }
        .form-group input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s;
        }
        .form-group input:focus {
            outline: none;
            border-color: #667eea;
        }
        .form-group input::placeholder {
            color: #999;
        }
        .remember-forgot {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            font-size: 13px;
        }
        .remember-me {
            display: flex;
            align-items: center;
            gap: 6px;
            color: #666;
        }
        .remember-me input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }
        .forgot-password {
            color: #667eea;
            text-decoration: none;
        }
        .forgot-password:hover {
            text-decoration: underline;
        }
        .login-button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
        }
        .login-button:active {
            transform: translateY(0);
        }
        .divider {
            display: flex;
            align-items: center;
            margin: 24px 0;
            color: #999;
            font-size: 13px;
        }
        .divider::before,
        .divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: #e0e0e0;
        }
        .divider span {
            padding: 0 16px;
        }
        .social-login {
            display: flex;
            gap: 12px;
        }
        .social-button {
            flex: 1;
            padding: 10px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            background: white;
            cursor: pointer;
            font-size: 14px;
            transition: border-color 0.3s, background 0.3s;
        }
        .social-button:hover {
            border-color: #667eea;
            background: #f5f5ff;
        }
        .signup-link {
            text-align: center;
            margin-top: 24px;
            color: #666;
            font-size: 14px;
        }
        .signup-link a {
            color: #667eea;
            text-decoration: none;
            font-weight: 500;
        }
        .signup-link a:hover {
            text-decoration: underline;
        }
        .error-message {
            background: #fee;
            color: #c33;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 16px;
            font-size: 14px;
            display: none;
        }
        .error-message.show {
            display: block;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-header">
            <h1>欢迎登录</h1>
            <p>请输入您的账户信息</p>
        </div>

        <div class="error-message" id="errorMessage"></div>

        <form id="loginForm">
            <div class="form-group">
                <label for="username">用户名 / 邮箱</label>
                <input
                    type="text"
                    id="username"
                    name="username"
                    placeholder="请输入用户名或邮箱"
                    autocomplete="username"
                >
            </div>

            <div class="form-group">
                <label for="password">密码</label>
                <input
                    type="password"
                    id="password"
                    name="password"
                    placeholder="请输入密码"
                    autocomplete="current-password"
                >
            </div>

            <div class="remember-forgot">
                <label class="remember-me">
                    <input type="checkbox" id="remember" name="remember">
                    <span>记住我</span>
                </label>
                <a href="#" class="forgot-password">忘记密码？</a>
            </div>

            <button type="submit" class="login-button">登 录</button>
        </form>

        <div class="divider">
            <span>或</span>
        </div>

        <div class="social-login">
            <button type="button" class="social-button">微信</button>
            <button type="button" class="social-button">QQ</button>
            <button type="button" class="social-button">GitHub</button>
        </div>

        <div class="signup-link">
            还没有账户？ <a href="#">立即注册</a>
        </div>
    </div>

    <script>
        const form = document.getElementById('loginForm');
        const errorMessage = document.getElementById('errorMessage');

        form.addEventListener('submit', async function(e) {
            e.preventDefault();

            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            // 简单的表单验证
            if (!username || !password) {
                showError('请填写用户名和密码');
                return;
            }

            if (password.length < 6) {
                showError('密码长度至少为6位');
                return;
            }

            try {
                // 调用登录 API
                const loginResponse = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const loginData = await loginResponse.json();

                if (!loginData.success) {
                    showError(loginData.message || '登录失败');
                    return;
                }

                // 保存 token
                localStorage.setItem('token', loginData.token);
                localStorage.setItem('user', JSON.stringify(loginData.user));

                console.log('登录成功:', loginData.user);

                // 加载租户信息
                try {
                    const tenantResponse = await fetch('/api/tenant', {
                        headers: { 'Authorization': 'Bearer ' + loginData.token }
                    });

                    const tenantData = await tenantResponse.json();

                    if (tenantData.success) {
                        localStorage.setItem('tenant', JSON.stringify(tenantData.tenant));
                        console.log('租户信息加载成功:', tenantData.tenant);

                        // 跳转到仪表板页面
                        window.location.href = '/dashboard';
                    } else {
                        console.error('加载租户信息失败:', tenantData.message);
                        alert('登录成功，但加载租户信息失败: ' + tenantData.message);
                        // 仍然跳转
                        window.location.href = '/dashboard';
                    }
                } catch (tenantError) {
                    console.error('加载租户信息出错:', tenantError);
                    alert('登录成功，但加载租户信息出错: ' + tenantError.message);
                    // 仍然跳转
                    window.location.href = '/dashboard';
                }

            } catch (error) {
                console.error('登录错误:', error);
                showError('登录失败: ' + error.message);
            }
        });

        function showError(message) {
            errorMessage.textContent = message;
            errorMessage.classList.add('show');
            setTimeout(() => {
                errorMessage.classList.remove('show');
            }, 3000);
        }

        // 社会化登录按钮点击
        document.querySelectorAll('.social-button').forEach(button => {
            button.addEventListener('click', function() {
                alert('社会化登录仅用于演示');
            });
        });
    </script>
</body>
</html>
`;

// 仪表板页面
const dashboardPage = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>仪表板 - 测试系统</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #f5f7fa;
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px 40px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header-left {
            display: flex;
            align-items: center;
            gap: 20px;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
        }
        .user-info {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .user-name {
            font-size: 16px;
        }
        .logout-btn {
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.3s;
        }
        .logout-btn:hover {
            background: rgba(255,255,255,0.3);
        }
        .container {
            max-width: 1200px;
            margin: 40px auto;
            padding: 0 20px;
        }
        .tenant-info {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        .tenant-info h2 {
            color: #333;
            margin-bottom: 16px;
            font-size: 20px;
        }
        .tenant-details {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
        }
        .detail-item {
            padding: 12px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .detail-label {
            color: #666;
            font-size: 13px;
            margin-bottom: 4px;
        }
        .detail-value {
            color: #333;
            font-size: 16px;
            font-weight: 500;
        }
        .section {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .section-title {
            color: #333;
            font-size: 20px;
            font-weight: 600;
        }
        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        .btn:active {
            transform: translateY(0);
        }
        .user-table {
            width: 100%;
            border-collapse: collapse;
        }
        .user-table th,
        .user-table td {
            padding: 12px 16px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        .user-table th {
            background: #f8f9fa;
            color: #666;
            font-weight: 600;
            font-size: 13px;
        }
        .user-table tr:hover {
            background: #f8f9fa;
        }
        .role-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }
        .role-admin {
            background: #e8f5e9;
            color: #2e7d32;
        }
        .role-user {
            background: #e3f2fd;
            color: #1565c0;
        }
        .platform-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 16px;
        }
        .platform-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 16px;
            border: 2px solid #e0e0e0;
        }
        .platform-card.disabled {
            opacity: 0.6;
        }
        .platform-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e0e0e0;
        }
        .platform-icon {
            font-size: 24px;
        }
        .platform-name {
            font-weight: 600;
            color: #333;
            flex: 1;
        }
        .platform-status {
            font-size: 12px;
            color: #666;
        }
        .platform-fields {
            font-size: 13px;
        }
        .platform-field {
            display: flex;
            padding: 4px 0;
        }
        .field-label {
            color: #666;
            min-width: 80px;
        }
        .field-value {
            color: #333;
            word-break: break-all;
        }
        .permission-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 12px;
            margin-top: 12px;
        }
        .permission-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: #f8f9fa;
            border-radius: 6px;
        }
        .permission-item input[type="checkbox"] {
            width: 18px;
            height: 18px;
        }
        .permission-label {
            font-size: 14px;
            color: #333;
        }
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .modal.show {
            display: flex;
        }
        .modal-content {
            background: white;
            border-radius: 12px;
            padding: 24px;
            width: 100%;
            max-width: 480px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .modal-title {
            color: #333;
            font-size: 18px;
            font-weight: 600;
        }
        .modal-close {
            background: none;
            border: none;
            font-size: 24px;
            color: #999;
            cursor: pointer;
        }
        .modal-close:hover {
            color: #333;
        }
        .form-group {
            margin-bottom: 16px;
        }
        .form-group label {
            display: block;
            color: #333;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 8px;
        }
        .form-group input,
        .form-group select {
            width: 100%;
            padding: 10px 14px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s;
        }
        .form-group input:focus,
        .form-group select:focus {
            outline: none;
            border-color: #667eea;
        }
        .modal-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 20px;
        }
        .btn-cancel {
            background: #f5f5f5;
            color: #666;
        }
        .btn-cancel:hover {
            background: #eee;
        }
        .message {
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 16px;
            display: none;
        }
        .message.show {
            display: block;
        }
        .message-success {
            background: #e8f5e9;
            color: #2e7d32;
        }
        .message-error {
            background: #ffebee;
            color: #c62828;
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        .empty-state {
            text-align: center;
            padding: 40px;
            color: #999;
        }
    </style>
</head>
<body>
    <header class="header">
        <div class="header-left">
            <div class="logo">测试系统</div>
            <div class="user-info">
                <span class="user-name" id="displayName">欢迎</span>
                <span id="tenantName"></span>
            </div>
        </div>
        <button class="logout-btn" id="logoutBtn">退出登录</button>
    </header>

    <div class="container">
        <div class="tenant-info">
            <h2>租户信息</h2>
            <div class="tenant-details">
                <div class="detail-item">
                    <div class="detail-label">租户名称</div>
                    <div class="detail-value" id="tenantName2">-</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">套餐类型</div>
                    <div class="detail-value" id="tenantPlan">-</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">最大用户数</div>
                    <div class="detail-value" id="tenantMaxUsers">-</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">功能特性</div>
                    <div class="detail-value" id="tenantFeatures">-</div>
                </div>
            </div>
        </div>

        <!-- 平台配置显示 -->
        <div class="section" id="platformConfigsSection">
            <div class="section-header">
                <h2 class="section-title">平台配置</h2>
            </div>
            <div id="platformConfigsContainer">
                <div class="loading">加载中...</div>
            </div>
        </div>

        <div class="section" id="adminSection" style="display: none;">
            <div class="section-header">
                <h2 class="section-title">租户管理</h2>
                <button class="btn" id="refreshTenantsBtn">刷新列表</button>
            </div>
            <div id="tenantsContainer">
                <div class="loading">加载中...</div>
            </div>
            <div class="section-header" style="margin-top: 20px;">
                <h3 class="section-title">添加新租户</h3>
                <button class="btn" id="addTenantBtn">+ 添加租户</button>
            </div>
            <div class="message" id="tenantMessage"></div>
        </div>

        <div class="section">
            <div class="section-header">
                <h2 class="section-title">用户列表</h2>
                <button class="btn" id="refreshUsersBtn">刷新列表</button>
            </div>
            <div id="usersContainer">
                <div class="loading">加载中...</div>
            </div>
        </div>
    </div>

    <!-- 添加租户模态框 -->
    <div class="modal" id="addTenantModal">
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <h3 class="modal-title">添加新租户</h3>
                <button class="modal-close" id="closeModal">&times;</button>
            </div>
            <div class="message" id="formMessage"></div>
            <form id="addTenantForm">
                <div class="form-group">
                    <label for="tenantNameInput">租户名称</label>
                    <input type="text" id="tenantNameInput" name="name" placeholder="请输入租户名称" required>
                </div>
                <div class="form-group">
                    <label for="tenantPlan">套餐类型</label>
                    <select id="tenantPlanSelect" name="plan">
                        <option value="basic">基础版</option>
                        <option value="enterprise">企业版</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="tenantMaxUsers">最大用户数</label>
                    <input type="number" id="tenantMaxUsersInput" name="maxUsers" value="10" min="1" max="1000">
                </div>

                <!-- 平台配置部分 -->
                <div class="form-group" style="border-top: 1px solid #eee; padding-top: 16px; margin-top: 16px;">
                    <label>平台配置 (可选)</label>
                    <p style="font-size: 12px; color: #666; margin-top: 4px;">选择要配置的社交平台</p>
                </div>
                <div class="form-group">
                    <label for="platformSelect">选择平台</label>
                    <select id="platformSelect">
                        <option value="">-- 选择平台 --</option>
                        <option value="discord">💬 Discord</option>
                        <option value="telegram">✈️ Telegram</option>
                        <option value="slack">💼 Slack</option>
                        <option value="feishu">📱 飞书</option>
                        <option value="dingtalk">🔔 钉钉</option>
                        <option value="wecom">💼 企业微信</option>
                        <option value="line">📱 LINE</option>
                    </select>
                </div>
                <div id="platformConfigFields"></div>
                <div id="platformInstructions" class="form-group" style="display: none;">
                    <div style="background: #f0f7ff; padding: 12px; border-radius: 8px; font-size: 12px; color: #333;">
                        <strong>配置说明:</strong>
                        <pre id="instructionsText" style="white-space: pre-wrap; margin-top: 8px;"></pre>
                    </div>
                </div>
                <div class="form-group">
                    <button type="button" class="btn btn-small" id="addPlatformBtn" style="display: none;">+ 添加平台配置</button>
                </div>
                <div id="selectedPlatforms"></div>

                <div class="modal-actions">
                    <button type="button" class="btn btn-cancel" id="cancelBtn">取消</button>
                    <button type="submit" class="btn">添加租户</button>
                </div>
            </form>
        </div>
    </div>

    <!-- 编辑租户模态框 -->
    <div class="modal" id="editTenantModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title">编辑租户</h3>
                <button class="modal-close" id="closeEditModal">&times;</button>
            </div>
            <div class="message" id="editFormMessage"></div>
            <form id="editTenantForm">
                <input type="hidden" id="editTenantId" name="id">
                <div class="form-group">
                    <label for="editTenantNameInput">租户名称</label>
                    <input type="text" id="editTenantNameInput" name="name" placeholder="请输入租户名称" required>
                </div>
                <div class="form-group">
                    <label for="editTenantPlanSelect">套餐类型</label>
                    <select id="editTenantPlanSelect" name="plan">
                        <option value="basic">基础版</option>
                        <option value="enterprise">企业版</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="editTenantMaxUsers">最大用户数</label>
                    <input type="number" id="editTenantMaxUsersInput" name="maxUsers" value="10" min="1" max="1000">
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-cancel" id="cancelEditBtn">取消</button>
                    <button type="submit" class="btn">保存修改</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        // 检查登录状态
        const token = localStorage.getItem('token');
        const user = localStorage.getItem('user');
        const tenant = localStorage.getItem('tenant');

        if (!token || !user) {
            // 未登录，跳转到登录页
            window.location.href = '/login';
            throw new Error('未登录');
        }

        const userData = JSON.parse(user);
        const tenantData = tenant ? JSON.parse(tenant) : null;

        // 显示用户信息
        document.getElementById('displayName').textContent = userData.name;

        if (tenantData) {
            document.getElementById('tenantName').textContent = '| ' + tenantData.name;
            document.getElementById('tenantName2').textContent = tenantData.name;
            document.getElementById('tenantPlan').textContent = tenantData.plan === 'enterprise' ? '企业版' : '基础版';
            document.getElementById('tenantMaxUsers').textContent = tenantData.maxUsers;
            document.getElementById('tenantFeatures').textContent = tenantData.features ? tenantData.features.join(', ') : '-';
            // 加载平台配置
            loadPlatformConfigs();
        }

        // 加载平台配置
        async function loadPlatformConfigs() {
            const container = document.getElementById('platformConfigsContainer');
            container.innerHTML = '<div class="loading">加载中...</div>';

            try {
                const response = await fetch('/api/tenant/platforms', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await response.json();

                if (data.success) {
                    if (data.configs && data.configs.length > 0) {
                        let html = '<div class="platform-grid">';
                        data.configs.forEach(config => {
                            const platformInfo = getPlatformInfo(config.platform);
                            html += '<div class="platform-card ' + (config.enabled ? '' : 'disabled') + '">';
                            html += '<div class="platform-header">';
                            html += '<span class="platform-icon">' + (platformInfo ? platformInfo.icon : '📱') + '</span>';
                            html += '<span class="platform-name">' + (platformInfo ? platformInfo.name : config.platform) + '</span>';
                            html += '<span class="platform-status">' + (config.enabled ? '✅ 已启用' : '❌ 已禁用') + '</span>';
                            html += '</div>';
                            html += '<div class="platform-fields">';
                            if (config.config) {
                                Object.keys(config.config).forEach(key => {
                                    if (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('password')) {
                                        html += '<div class="platform-field"><span class="field-label">' + key + ':</span> <span class="field-value">******</span></div>';
                                    } else if (typeof config.config[key] === 'string' && config.config[key]) {
                                        html += '<div class="platform-field"><span class="field-label">' + key + ':</span> <span class="field-value">' + config.config[key] + '</span></div>';
                                    }
                                });
                            }
                            html += '</div></div>';
                        });
                        html += '</div>';
                        container.innerHTML = html;
                    } else {
                        container.innerHTML = '<div class="empty-state">暂无平台配置，请添加</div>';
                    }
                } else {
                    container.innerHTML = '<div class="empty-state">加载失败: ' + data.message + '</div>';
                }
            } catch (error) {
                container.innerHTML = '<div class="empty-state">加载失败: ' + error.message + '</div>';
            }
        }

        // 获取平台信息
        function getPlatformInfo(platformId) {
            const platforms = {
                discord: { name: 'Discord', icon: '💬' },
                telegram: { name: 'Telegram', icon: '✈️' },
                slack: { name: 'Slack', icon: '💼' },
                feishu: { name: '飞书', icon: '📱' },
                dingtalk: { name: '钉钉', icon: '🔔' },
                wecom: { name: '企业微信', icon: '💼' },
                line: { name: 'LINE', icon: '📱' }
            };
            return platforms[platformId];
        }

        // 显示管理员部分
        if (userData.role === 'admin') {
            document.getElementById('adminSection').style.display = 'block';
            // 加载租户列表
            loadTenants();
        }

        // 退出登录
        document.getElementById('logoutBtn').addEventListener('click', function() {
            localStorage.clear();
            window.location.href = '/login';
        });

        // 加载用户列表
        async function loadUsers() {
            const container = document.getElementById('usersContainer');
            container.innerHTML = '<div class="loading">加载中...</div>';

            try {
                const response = await fetch('/api/users', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await response.json();

                if (data.success) {
                    if (data.users && data.users.length > 0) {
                        let html = '<table class="user-table"><thead><tr><th>ID</th><th>用户名</th><th>姓名</th><th>角色</th><th>权限</th><th>操作</th></tr></thead><tbody>';
                        data.users.forEach(u => {
                            const perms = u.permissions || [];
                            html += '<tr>';
                            html += '<td>' + u.id + '</td>';
                            html += '<td>' + u.username + '</td>';
                            html += '<td>' + u.name + '</td>';
                            html += '<td><span class="role-badge ' + (u.role === 'admin' ? 'role-admin' : 'role-user') + '">' + (u.role === 'admin' ? '管理员' : '普通用户') + '</span></td>';
                            html += '<td>' + (perms.length > 0 ? perms.join(', ') : '-') + '</td>';
                            html += '<td><button class="btn btn-small edit-perm-btn" data-id="' + u.id + '" data-name="' + u.name + '">管理权限</button></td>';
                            html += '</tr>';
                        });
                        html += '</tbody></table>';
                        container.innerHTML = html;

                        // 绑定权限按钮事件
                        document.querySelectorAll('.edit-perm-btn').forEach(btn => {
                            btn.addEventListener('click', function() {
                                openPermissionModal(this.dataset.id, this.dataset.name);
                            });
                        });
                    } else {
                        container.innerHTML = '<div class="empty-state">暂无用户数据</div>';
                    }
                } else {
                    container.innerHTML = '<div class="empty-state">加载失败: ' + data.message + '</div>';
                }
            } catch (error) {
                container.innerHTML = '<div class="empty-state">加载失败: ' + error.message + '</div>';
            }
        }

        // 权限定义
        const PERMISSIONS = [
            { key: 'modify_config', name: '修改服务器配置', description: '可以修改租户的服务器配置' },
            { key: 'call_claude', name: '调用Claude Code', description: '可以通过AI进行对话' },
            { key: 'send_message', name: '发送消息', description: '可以通过社交平台发送消息' },
            { key: 'receive_message', name: '接收消息', description: '可以接收来自社交平台的消息' }
        ];

        // 权限模态框
        let permissionModal = null;

        function openPermissionModal(userId, userName) {
            // 创建模态框
            if (!permissionModal) {
                permissionModal = document.createElement('div');
                permissionModal.className = 'modal show';
                permissionModal.id = 'permissionModal';
                permissionModal.innerHTML = '<div class="modal-content">' +
                    '<div class="modal-header">' +
                    '<h3 class="modal-title" id="permModalTitle">权限管理</h3>' +
                    '<button class="modal-close" id="closePermModal">&times;</button>' +
                    '</div>' +
                    '<div class="message" id="permFormMessage"></div>' +
                    '<div id="permissionList"></div>' +
                    '<div class="modal-actions">' +
                    '<button type="button" class="btn btn-cancel" id="cancelPermBtn">取消</button>' +
                    '<button type="button" class="btn" id="savePermBtn">保存权限</button>' +
                    '</div>' +
                    '</div>';
                document.body.appendChild(permissionModal);

                // 绑定关闭事件
                document.getElementById('closePermModal').addEventListener('click', closePermissionModal);
                document.getElementById('cancelPermBtn').addEventListener('click', closePermissionModal);
                permissionModal.addEventListener('click', function(e) {
                    if (e.target === permissionModal) closePermissionModal();
                });
            }

            // 加载当前用户权限
            loadUserPermissions(userId, userName);
            permissionModal.classList.add('show');
        }

        function closePermissionModal() {
            if (permissionModal) {
                permissionModal.classList.remove('show');
            }
        }

        async function loadUserPermissions(userId, userName) {
            document.getElementById('permModalTitle').textContent = '权限管理 - ' + userName;
            const permList = document.getElementById('permissionList');

            try {
                const response = await fetch('/api/permissions/' + userId, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await response.json();

                if (data.success) {
                    const userPerms = data.permissions || [];
                    let html = '<div class="permission-grid">';
                    PERMISSIONS.forEach(p => {
                        html += '<div class="permission-item">';
                        html += '<input type="checkbox" id="perm_' + p.key + '" value="' + p.key + '" ' + (userPerms.includes(p.key) ? 'checked' : '') + '>';
                        html += '<label class="permission-label" for="perm_' + p.key + '">' + p.name + '</label>';
                        html += '</div>';
                    });
                    html += '</div>';
                    permList.innerHTML = html;
                } else {
                    permList.innerHTML = '<div class="message show">加载失败: ' + data.message + '</div>';
                }
            } catch (error) {
                permList.innerHTML = '<div class="message show">加载失败: ' + error.message + '</div>';
            }

            // 保存权限按钮
            document.getElementById('savePermBtn').onclick = async function() {
                const checkboxes = document.querySelectorAll('#permissionList input[type="checkbox"]:checked');
                const selectedPerms = Array.from(checkboxes).map(cb => cb.value);

                try {
                    const response = await fetch('/api/permissions/' + userId, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + token
                        },
                        body: JSON.stringify({ permissions: selectedPerms })
                    });
                    const data = await response.json();

                    if (data.success) {
                        document.getElementById('permFormMessage').className = 'message show message-success';
                        document.getElementById('permFormMessage').textContent = '权限保存成功';
                        setTimeout(function() {
                            closePermissionModal();
                            loadUsers();
                        }, 1000);
                    } else {
                        document.getElementById('permFormMessage').className = 'message show';
                        document.getElementById('permFormMessage').textContent = data.message;
                    }
                } catch (error) {
                    document.getElementById('permFormMessage').className = 'message show';
                    document.getElementById('permFormMessage').textContent = '保存失败: ' + error.message;
                }
            };
        }

        // 刷新用户列表
        document.getElementById('refreshUsersBtn').addEventListener('click', loadUsers);

        // 加载租户列表（仅管理员）
        async function loadTenants() {
            const container = document.getElementById('tenantsContainer');
            container.innerHTML = '<div class="loading">加载中...</div>';

            try {
                const response = await fetch('/api/tenants', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await response.json();

                if (data.success) {
                    if (data.tenants && data.tenants.length > 0) {
                        let html = '<table class="user-table"><thead><tr><th>ID</th><th>租户名称</th><th>套餐</th><th>最大用户数</th><th>功能特性</th><th>操作</th></tr></thead><tbody>';
                        data.tenants.forEach(t => {
                            html += '<tr><td>' + t.id + '</td><td>' + t.name + '</td><td>' + (t.plan === 'enterprise' ? '企业版' : '基础版') + '</td><td>' + t.maxUsers + '</td><td>' + (t.features ? t.features.join(', ') : '-') + '</td><td><button class="btn btn-small edit-tenant-btn" data-id="' + t.id + '" data-name="' + t.name + '" data-plan="' + t.plan + '" data-maxusers="' + t.maxUsers + '">编辑</button></td></tr>';
                        });
                        html += '</tbody></table>';
                        container.innerHTML = html;

                        // 为编辑按钮绑定事件
                        document.querySelectorAll('.edit-tenant-btn').forEach(btn => {
                            btn.addEventListener('click', function() {
                                openEditTenantModal(this.dataset.id, this.dataset.name, this.dataset.plan, this.dataset.maxusers);
                            });
                        });
                    } else {
                        container.innerHTML = '<div class="empty-state">暂无租户数据</div>';
                    }
                } else {
                    container.innerHTML = '<div class="empty-state">加载失败: ' + data.message + '</div>';
                }
            } catch (error) {
                container.innerHTML = '<div class="empty-state">加载失败: ' + error.message + '</div>';
            }
        }

        // 刷新租户列表按钮
        document.getElementById('refreshTenantsBtn').addEventListener('click', loadTenants);

        // 初始加载用户列表
        loadUsers();

        // 添加租户模态框
        const modal = document.getElementById('addTenantModal');
        const addTenantBtn = document.getElementById('addTenantBtn');
        const closeModal = document.getElementById('closeModal');
        const cancelBtn = document.getElementById('cancelBtn');
        const formMessage = document.getElementById('formMessage');

        addTenantBtn.addEventListener('click', function() {
            modal.classList.add('show');
            formMessage.className = 'message';
            formMessage.textContent = '';
            document.getElementById('addTenantForm').reset();
        });

        function closeModalFunc() {
            modal.classList.remove('show');
        }

        closeModal.addEventListener('click', closeModalFunc);
        cancelBtn.addEventListener('click', closeModalFunc);

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModalFunc();
            }
        });

        // 提交添加租户表单
        document.getElementById('addTenantForm').addEventListener('submit', async function(e) {
            e.preventDefault();

            const name = document.getElementById('tenantNameInput').value;
            const plan = document.getElementById('tenantPlanSelect').value;
            const maxUsers = parseInt(document.getElementById('tenantMaxUsersInput').value);

            // 收集平台配置
            const platformConfigs = [];
            document.querySelectorAll('.platform-config-item').forEach(item => {
                const platform = item.dataset.platform;
                const config = {};
                item.querySelectorAll('input, select').forEach(input => {
                    config[input.name] = input.value;
                });
                if (Object.keys(config).some(k => config[k])) {
                    platformConfigs.push({ platform, config });
                }
            });

            formMessage.className = 'message show';
            formMessage.textContent = '提交中...';

            try {
                const response = await fetch('/api/tenant/add', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ name, plan, maxUsers, platformConfigs })
                });

                const data = await response.json();

                if (data.success) {
                    formMessage.className = 'message show message-success';
                    formMessage.textContent = '租户添加成功: ' + data.tenant.name;

                    // 刷新租户列表
                    loadTenants();

                    setTimeout(function() {
                        closeModalFunc();
                    }, 1500);
                } else {
                    formMessage.className = 'message show message-error';
                    formMessage.textContent = data.message || '添加失败';
                }
            } catch (error) {
                formMessage.className = 'message show message-error';
                formMessage.textContent = '添加失败: ' + error.message;
            }
        });

        // 平台选择变化时显示对应配置
        const platformConfigsData = {
            discord: {
                name: 'Discord',
                fields: [
                    { name: 'token', label: 'Bot Token', type: 'password', placeholder: 'MTAx...', required: true }
                ],
                instructions: '获取 Discord Bot Token:\n1. 访问 https://discord.com/developers/applications\n2. 创建新应用 → Bot → Reset Token\n3. 启用 MESSAGE CONTENT INTENT\n4. 生成邀请链接: OAuth2 → URL Generator → bot 权限'
            },
            telegram: {
                name: 'Telegram',
                fields: [
                    { name: 'botToken', label: 'Bot Token', type: 'password', placeholder: '123456:ABC-DEF...', required: true }
                ],
                instructions: '获取 Telegram Bot Token:\n1. 在 Telegram 中搜索 @BotFather\n2. 发送 /newbot 创建新机器人\n3. 按提示设置名称和用户名\n4. 获取 Bot Token'
            },
            slack: {
                name: 'Slack',
                fields: [
                    { name: 'botToken', label: 'Bot Token', type: 'password', placeholder: 'xoxb-...', required: true },
                    { name: 'signingSecret', label: 'Signing Secret', type: 'password', placeholder: '...', required: true }
                ],
                instructions: '获取 Slack 配置:\n1. 访问 https://api.slack.com/apps\n2. 创建新 App (From scratch)\n3. 在 OAuth & Permissions 添加 scopes\n4. 安装到工作区获取 Bot Token'
            },
            feishu: {
                name: '飞书',
                fields: [
                    { name: 'appId', label: 'App ID', type: 'text', placeholder: 'cli_xxxxx', required: true },
                    { name: 'appSecret', label: 'App Secret', type: 'password', placeholder: '...', required: true }
                ],
                instructions: '获取飞书配置:\n1. 访问 https://open.feishu.cn/app\n2. 创建企业自建应用\n3. 在应用设置中获取 App ID 和 App Secret\n4. 添加权限并发布'
            },
            dingtalk: {
                name: '钉钉',
                fields: [
                    { name: 'agentId', label: 'Agent ID', type: 'text', placeholder: '...', required: true },
                    { name: 'appKey', label: 'App Key', type: 'text', placeholder: 'ding...', required: true },
                    { name: 'appSecret', label: 'App Secret', type: 'password', placeholder: '...', required: true }
                ],
                instructions: '获取钉钉配置:\n1. 访问 https://open.dingtalk.com\n2. 创建企业自建应用\n3. 在应用详情获取 Agent ID\n4. 在应用凭证获取 App Key 和 App Secret'
            },
            wecom: {
                name: '企业微信',
                fields: [
                    { name: 'corpId', label: 'Corp ID', type: 'text', placeholder: 'ww...', required: true },
                    { name: 'corpSecret', label: 'Corp Secret', type: 'password', placeholder: '...', required: true },
                    { name: 'agentId', label: 'Agent ID', type: 'text', placeholder: '...', required: true }
                ],
                instructions: '获取企业微信配置:\n1. 访问 https://work.weixin.qq.com\n2. 创建自建应用\n3. 在应用管理获取 Agent ID\n4. 在我的企业获取 Corp ID'
            },
            line: {
                name: 'LINE',
                fields: [
                    { name: 'channelAccessToken', label: 'Channel Access Token', type: 'password', placeholder: '...', required: true },
                    { name: 'channelSecret', label: 'Channel Secret', type: 'password', placeholder: '...', required: true }
                ],
                instructions: '获取 LINE 配置:\n1. 访问 https://developers.line.biz\n2. 创建 Provider 和 Channel\n3. 在 Messaging API 获取 Channel Access Token\n4. 在 Basic Settings 获取 Channel Secret'
            }
        };

        // 平台选择事件
        document.getElementById('platformSelect').addEventListener('change', function() {
            const platform = this.value;
            const configFields = document.getElementById('platformConfigFields');
            const instructionsDiv = document.getElementById('platformInstructions');
            const addBtn = document.getElementById('addPlatformBtn');

            if (!platform || !platformConfigsData[platform]) {
                configFields.innerHTML = '';
                instructionsDiv.style.display = 'none';
                addBtn.style.display = 'none';
                return;
            }

            const config = platformConfigsData[platform];
            let html = '<div class="form-group">';
            config.fields.forEach(field => {
                html += '<label for="platform_' + field.name + '">' + field.label + (field.required ? ' *' : '') + '</label>';
                if (field.type === 'select') {
                    html += '<select id="platform_' + field.name + '" name="' + field.name + '"' + (field.required ? ' required' : '') + '>';
                    if (field.options) {
                        field.options.forEach(opt => {
                            html += '<option value="' + opt + '">' + opt + '</option>';
                        });
                    }
                    html += '</select>';
                } else {
                    html += '<input type="' + field.type + '" id="platform_' + field.name + '" name="' + field.name + '" placeholder="' + (field.placeholder || '') + '"' + (field.required ? ' required' : '') + '>';
                }
            });
            html += '</div>';
            configFields.innerHTML = html;

            // 显示配置说明
            document.getElementById('instructionsText').textContent = config.instructions;
            instructionsDiv.style.display = 'block';
            addBtn.style.display = 'inline-block';
        });

        // 添加平台配置按钮
        document.getElementById('addPlatformBtn').addEventListener('click', function() {
            const platform = document.getElementById('platformSelect').value;
            if (!platform || !platformConfigsData[platform]) return;

            const config = platformConfigsData[platform];
            const selectedPlatforms = document.getElementById('selectedPlatforms');

            // 检查是否已添加
            if (selectedPlatforms.querySelector('[data-platform="' + platform + '"]')) {
                alert('该平台已添加');
                return;
            }

            let html = '<div class="platform-config-item" data-platform="' + platform + '" style="background: #f5f5f5; padding: 12px; border-radius: 8px; margin-bottom: 12px;">';
            html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">';
            html += '<strong>' + config.name + '</strong>';
            html += '<button type="button" class="btn btn-small" onclick="this.parentElement.parentElement.remove()">删除</button>';
            html += '</div>';

            config.fields.forEach(field => {
                const value = document.getElementById('platform_' + field.name).value;
                html += '<div class="form-group" style="margin-bottom: 8px;">';
                html += '<label style="font-size: 12px;">' + field.label + '</label>';
                html += '<input type="' + field.type + '" name="' + field.name + '" value="' + value + '" style="width: 100%;">';
                html += '</div>';
            });
            html += '</div>';

            selectedPlatforms.insertAdjacentHTML('beforeend', html);

            // 清空表单
            document.getElementById('platformSelect').value = '';
            document.getElementById('platformConfigFields').innerHTML = '';
            document.getElementById('platformInstructions').style.display = 'none';
            this.style.display = 'none';
        });

        // 编辑租户模态框
        const editModal = document.getElementById('editTenantModal');
        const editFormMessage = document.getElementById('editFormMessage');
        const closeEditModal = document.getElementById('closeEditModal');
        const cancelEditBtn = document.getElementById('cancelEditBtn');

        function openEditTenantModal(id, name, plan, maxUsers) {
            document.getElementById('editTenantId').value = id;
            document.getElementById('editTenantNameInput').value = name;
            document.getElementById('editTenantPlanSelect').value = plan;
            document.getElementById('editTenantMaxUsersInput').value = maxUsers;
            editFormMessage.className = 'message';
            editFormMessage.textContent = '';
            editModal.classList.add('show');
        }

        function closeEditModalFunc() {
            editModal.classList.remove('show');
        }

        closeEditModal.addEventListener('click', closeEditModalFunc);
        cancelEditBtn.addEventListener('click', closeEditModalFunc);

        editModal.addEventListener('click', function(e) {
            if (e.target === editModal) {
                closeEditModalFunc();
            }
        });

        // 初始化租户下拉选择框（修复 initTenantSelects is not defined 问题）
        function initTenantSelects() {
            // 初始化编辑租户表单的下拉选择框
            const planSelect = document.getElementById('editTenantPlanSelect');
            if (planSelect && planSelect.options.length === 0) {
                planSelect.innerHTML = '<option value="basic">基础版</option><option value="enterprise">企业版</option>';
            }
        }

        // 提交编辑租户表单
        document.getElementById('editTenantForm').addEventListener('submit', async function(e) {
            e.preventDefault();

            const id = document.getElementById('editTenantId').value;
            const name = document.getElementById('editTenantNameInput').value;
            const plan = document.getElementById('editTenantPlanSelect').value;
            const maxUsers = parseInt(document.getElementById('editTenantMaxUsersInput').value);

            editFormMessage.className = 'message show';
            editFormMessage.textContent = '提交中...';

            try {
                const response = await fetch('/api/tenant/update', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ id, name, plan, maxUsers })
                });

                const data = await response.json();

                if (data.success) {
                    editFormMessage.className = 'message show message-success';
                    editFormMessage.textContent = '租户信息更新成功';

                    // 刷新租户列表
                    loadTenants();

                    setTimeout(function() {
                        closeEditModalFunc();
                    }, 1500);
                } else {
                    editFormMessage.className = 'message show message-error';
                    editFormMessage.textContent = data.message || '更新失败';
                }
            } catch (error) {
                editFormMessage.className = 'message show message-error';
                editFormMessage.textContent = '请求失败: ' + error.message;
            }
        });

        // 页面加载完成后初始化下拉选择框
        initTenantSelects();
    </script>
</body>
</html>
`;

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    // 健康检查端点 (版本 2026.3.1)
    if (url === '/health' || url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '2026.3.1'
        }));
        return;
    }

    // 就绪检查端点
    if (url === '/ready' || url === '/readyz') {
        // 检查服务是否就绪（这里简单返回成功，实际可以检查数据库等）
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ready',
            timestamp: new Date().toISOString(),
            version: '2026.3.1'
        }));
        return;
    }

    // API 请求处理
    if (req.url.startsWith('/api/')) {
        await handleApi(req, res);
        return;
    }

    // 页面路由
    if (req.url === '/' || req.url === '/login') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginPage);
    } else if (req.url === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(dashboardPage);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// 初始化数据库
initDatabase();

server.listen(PORT, '0.0.0.0', () => {
    // 获取服务器IP
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let serverIp = 'localhost';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                serverIp = iface.address;
                break;
            }
        }
        if (serverIp !== 'localhost') break;
    }
    console.log(`登录页面服务器已启动: http://localhost:${PORT}`);
    console.log(`外网访问: http://${serverIp}:${PORT}`);
    console.log('按 Ctrl+C 停止服务器');
});
