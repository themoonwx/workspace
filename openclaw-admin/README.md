# OpenClaw Admin - 多用户权限管理系统

## 项目介绍

OpenClaw Admin 是一个用于管理 OpenClaw 多用户权限的后台管理系统。通过这个平台，管理员可以：
- 管理多个平台的用户（钉钉、飞书、Telegram 等）
- 配置用户的权限级别
- 控制用户对服务器配置的修改权限
- 自动同步配置到 OpenClaw Gateway

## 功能列表

### 1. 用户管理
- 添加、编辑、删除用户
- 支持多个平台：钉钉、飞书、Telegram、Discord、Slack、企业微信、LINE
- 凭证管理（app_key, app_secret, agent_id 等）

### 2. 权限管理
| 权限名称 | 说明 |
|---------|------|
| 发送消息 | 用户可以发送消息 |
| 接收消息 | 用户可以接收消息 |
| 调用 Claude Code | 用户可以使用 AI 能力 |
| 修改服务端配置 | 用户可以修改 OpenClaw 配置（需要特殊权限） |
| 上传文件 | 用户可以上传文件 |
| 查看日志 | 用户可以查看操作日志 |

### 3. 限流配置
- 每日消息数限制
- 最大文件大小限制（MB）
- 最大并发数

### 4. 群组配置
- 启用群组设置
- 配置管理员 ID
- 权限控制

## 权限控制机制

修改服务端配置需要**同时满足**以下三个条件：

| 条件 | 说明 |
|------|------|
| 群开关开启 | 在"群组配置"中启用 |
| 有管理员 ID | 输入管理员的用户 ID（多个用逗号分隔） |
| 修改配置开关开启 | 在"权限配置"中开启"修改服务端配置" |

只有满足以上三个条件，用户才能：
1. 修改 OpenClaw 配置
2. 查看敏感信息（API keys、tokens 等）
3. 执行命令

## 使用方法

### 1. 启动服务

```bash
cd /home/ubuntu/workspace/openclaw-admin/backend
node server.js
```

服务默认运行在 http://localhost:3002

### 2. 添加用户

1. 登录管理后台
2. 点击"添加用户"
3. 选择平台（钉钉/飞书等）
4. 填写凭证信息
5. 保存

### 3. 配置权限

1. 点击用户列表中的"权限"按钮
2. 配置各项权限开关
3. 如需修改配置权限，需要：
   - 在"群组配置"中启用群组
   - 输入管理员 ID
   - 开启"修改服务端配置"开关

### 4. 测试权限

权限配置会自动同步到 Gateway，无需重启。

## 配置文件

### 权限配置
位置：`/home/ubuntu/.openclaw/permissions.json`

```json
{
  "groupSettings": {
    "enabled": true,
    "adminIds": "用户ID1,用户ID2",
    "modifyServerEnabled": true
  }
}
```

### OpenClaw 配置
位置：`/home/ubuntu/.openclaw/openclaw.json`

## 技术架构

- **后端**：Express.js + SQLite
- **前端**：单页面应用 (HTML + JavaScript)
- **认证**：JWT Token
- **配置同步**：自动写入 OpenClaw 配置文件

## 目录结构

```
/home/ubuntu/workspace/openclaw-admin/
├── backend/
│   ├── server.js    # Express 后端
│   └── db.js        # SQLite 数据库
├── frontend/
│   └── index.html   # 管理界面
├── README.md        # 说明文档
└── package.json
```

## 常见问题

### Q: 修改权限后需要重启 Gateway 吗？
A: 不需要。权限配置放在 `/home/ubuntu/.openclaw/permissions.json`，Gateway 会自动热加载。

### Q: 为什么非管理员也能修改配置？
A: 检查权限配置是否正确：
1. 群开关是否开启
2. 管理员 ID 是否正确
3. 修改配置开关是否开启

### Q: 权限不生效怎么办？
A: 检查日志：
```bash
tail -f /tmp/gateway.log | grep "权限"
```

## 遗留问题

1. **exec 执行命令权限可能不生效** - 某些命令执行不通过标准 exec.approval 接口，权限检查可能无效

2. **飞书长链接模式** - 可能需要额外配置

3. **sessionKey 提取** - 权限检查依赖于从 sessionKey 中提取用户 ID，不同平台格式可能不同

## 访问地址

> 注意：实际部署时请根据实际情况修改访问地址和账号密码
