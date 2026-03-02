const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;

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

            const user = users.find(u => u.username === username && u.password === password);

            if (user) {
                // 返回 token 和用户信息（实际应该使用 JWT）
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
                const user = users.find(u => u.id === parseInt(userId));

                if (user) {
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: true,
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
                const tenant = tenants[tenantId];

                if (tenant) {
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, tenant }));
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
                const tenantUsers = users.filter(u => u.tenantId === tenantId).map(u => ({
                    id: u.id,
                    username: u.username,
                    name: u.name,
                    role: u.role,
                    tenantId: u.tenantId
                }));

                res.writeHead(200);
                res.end(JSON.stringify({ success: true, users: tenantUsers }));
            } catch (e) {
                res.writeHead(401);
                res.end(JSON.stringify({ success: false, message: '无效的 token' }));
            }
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
                const currentUser = users.find(u => u.id === parseInt(userId));

                // 检查是否是管理员
                if (!currentUser || currentUser.role !== 'admin') {
                    res.writeHead(403);
                    res.end(JSON.stringify({ success: false, message: '只有管理员才能添加租户' }));
                    return;
                }

                const body = await parseBody(req);
                const { name, plan, maxUsers } = body;

                if (!name) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, message: '租户名称不能为空' }));
                    return;
                }

                // 生成新租户ID
                const newTenantId = 'tenant-' + Date.now();

                // 创建新租户
                const newTenant = {
                    id: newTenantId,
                    name: name,
                    plan: plan || 'basic',
                    maxUsers: maxUsers || 10,
                    features: plan === 'enterprise' ? ['analytics', 'api', 'customDomain'] : ['analytics']
                };

                tenants[newTenantId] = newTenant;

                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: '租户添加成功', tenant: newTenant }));
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
                const currentUser = users.find(u => u.id === parseInt(userId));

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
                if (!tenants[id]) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ success: false, message: '租户不存在' }));
                    return;
                }

                // 更新租户信息
                tenants[id].name = name;
                tenants[id].plan = plan || tenants[id].plan || 'basic';
                tenants[id].maxUsers = maxUsers || tenants[id].maxUsers || 10;
                tenants[id].features = plan === 'enterprise' ? ['analytics', 'api', 'customDomain'] : ['analytics'];

                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: '租户更新成功', tenant: tenants[id] }));
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
                const currentUser = users.find(u => u.id === parseInt(userId));

                // 检查是否是管理员
                if (!currentUser || currentUser.role !== 'admin') {
                    res.writeHead(403);
                    res.end(JSON.stringify({ success: false, message: '只有管理员才能查看所有租户' }));
                    return;
                }

                const tenantList = Object.values(tenants);
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
        <div class="modal-content">
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
                        let html = '<table class="user-table"><thead><tr><th>ID</th><th>用户名</th><th>姓名</th><th>角色</th></tr></thead><tbody>';
                        data.users.forEach(u => {
                            html += '<tr><td>' + u.id + '</td><td>' + u.username + '</td><td>' + u.name + '</td><td><span class="role-badge ' + (u.role === 'admin' ? 'role-admin' : 'role-user') + '">' + (u.role === 'admin' ? '管理员' : '普通用户') + '</span></td></tr>';
                        });
                        html += '</tbody></table>';
                        container.innerHTML = html;
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

            formMessage.className = 'message show';
            formMessage.textContent = '提交中...';

            try {
                const response = await fetch('/api/tenant/add', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ name, plan, maxUsers })
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

server.listen(PORT, () => {
    console.log(`登录页面服务器已启动: http://localhost:${PORT}`);
    console.log('按 Ctrl+C 停止服务器');
});
