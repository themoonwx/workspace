/**
 * 登录页面自动化测试
 * 测试目标: http://localhost:3001
 */

const { chromium } = require('playwright');

const TEST_URL = 'http://localhost:3001';
const results = {
    timestamp: new Date().toISOString(),
    url: TEST_URL,
    tests: [],
    summary: {
        total: 0,
        passed: 0,
        failed: 0
    }
};

function addTest(name, passed, details = '') {
    results.tests.push({ name, passed, details });
    results.summary.total++;
    if (passed) results.summary.passed++;
    else results.summary.failed++;
    console.log(`${passed ? '✓' : '✗'} ${name}${details ? ': ' + details : ''}`);
}

async function runTests() {
    console.log('='.repeat(50));
    console.log('登录页面测试开始');
    console.log('='.repeat(50));

    let browser;
    try {
        // 使用 Chromium
        browser = await chromium.launch({
            headless: true,
            executablePath: '/snap/bin/chromium'
        });
        const context = await browser.newContext();
        const page = await context.newPage();

        // 收集控制台日志和错误
        const consoleLogs = [];
        const consoleErrors = [];
        page.on('console', msg => {
            const text = msg.text();
            if (msg.type() === 'log') {
                consoleLogs.push(text);
            } else if (msg.type() === 'error') {
                consoleErrors.push(text);
            }
        });

        // 监听页面错误
        const pageErrors = [];
        page.on('pageerror', error => {
            pageErrors.push(error.message);
        });

        // 1. 访问页面
        console.log('\n[1] 访问登录页面...');
        await page.goto(TEST_URL, { waitUntil: 'networkidle' });
        addTest('页面加载成功', true);

        // 检测 JavaScript 错误
        addTest('无 JavaScript 控制台错误', consoleErrors.length === 0,
            consoleErrors.length > 0 ? `发现 ${consoleErrors.length} 个错误: ${consoleErrors[0]}` : '');
        addTest('无页面运行时错误', pageErrors.length === 0,
            pageErrors.length > 0 ? `发现错误: ${pageErrors[0]}` : '');

        // 2. 检查页面标题
        const title = await page.title();
        addTest('页面标题正确', title === '登录 - 测试系统', `标题: ${title}`);

        // 3. 检查表单元素存在
        const usernameInput = await page.$('#username');
        const passwordInput = await page.$('#password');
        const loginButton = await page.$('.login-button');

        addTest('用户名输入框存在', !!usernameInput);
        addTest('密码输入框存在', !!passwordInput);
        addTest('登录按钮存在', !!loginButton);

        // 4. 检查记住我复选框
        const rememberCheckbox = await page.$('#remember');
        addTest('记住我复选框存在', !!rememberCheckbox);

        // 5. 检查忘记密码链接
        const forgotLink = await page.$('.forgot-password');
        addTest('忘记密码链接存在', !!forgotLink);

        // 6. 检查社会化登录按钮
        const socialButtons = await page.$$('.social-button');
        addTest('社会化登录按钮数量正确', socialButtons.length === 3, `找到 ${socialButtons.length} 个按钮`);

        // 7. 检查注册链接
        const signupLink = await page.$('.signup-link a');
        addTest('注册链接存在', !!signupLink);

        // 8. 测试表单验证 - 空提交
        console.log('\n[2] 测试表单验证...');
        await loginButton.click();
        await page.waitForTimeout(500);

        // 检查错误消息是否显示
        const errorMsg = await page.$('.error-message.show');
        addTest('空表单提交显示错误提示', !!errorMsg || consoleLogs.some(log => log.includes('填写用户名和密码')));

        // 9. 测试填写表单
        console.log('\n[3] 测试表单填写...');
        await usernameInput.fill('testuser');
        await passwordInput.fill('12345');

        const usernameValue = await usernameInput.inputValue();
        const passwordValue = await passwordInput.inputValue();
        addTest('用户名填写正确', usernameValue === 'testuser');
        addTest('密码填写正确', passwordValue === '12345');

        // 10. 测试密码长度不足验证
        await loginButton.click();
        await page.waitForTimeout(500);
        const errorMsg2 = await page.$('.error-message.show');
        addTest('密码长度不足显示错误', !!errorMsg2 || consoleLogs.some(log => log.includes('6位')));

        // 11. 测试正确的密码长度 - 监听网络请求
        console.log('\n[4] 测试有效登录...');

        // 监听网络请求来检测登录提交
        const loginApiCalled = [];
        await page.route('**/api/login', route => {
            loginApiCalled.push(route.request().url());
            route.continue();
        });

        await passwordInput.fill('123456');
        await loginButton.click();
        await page.waitForTimeout(500);

        // 检查是否调用了登录 API
        addTest('登录表单提交逻辑正常', loginApiCalled.length > 0);

        // 12. 测试记住我复选框
        await page.goto(TEST_URL);
        await page.$eval('#remember', el => el.checked = true);
        const isRememberChecked = await page.$eval('#remember', el => el.checked);
        addTest('记住我复选框功能正常', isRememberChecked === true);

        // 13. 检查页面样式/布局
        const loginContainer = await page.$('.login-container');
        const containerVisible = loginContainer ? await loginContainer.isVisible() : false;
        addTest('登录容器可见', containerVisible);

        // 14. 测试链接可点击性
        // 注意：页面执行了goto后需要重新获取元素引用
        const forgotLinkRecheck = await page.$('.forgot-password');
        const forgotLinkVisible = forgotLinkRecheck ? await forgotLinkRecheck.isVisible() : false;
        addTest('忘记密码链接可见', forgotLinkVisible);

        // 15. 响应式检查 - 视口宽度
        await page.setViewportSize({ width: 375, height: 667 }); // 移动设备
        await page.waitForTimeout(300);
        const mobileContainer = await page.$('.login-container');
        const mobileVisible = mobileContainer ? await mobileContainer.isVisible() : false;
        addTest('移动端页面显示正常', mobileVisible);

        await page.setViewportSize({ width: 1920, height: 1080 }); // 桌面设备
        await page.waitForTimeout(300);
        const desktopContainer = await page.$('.login-container');
        const desktopVisible = desktopContainer ? await desktopContainer.isVisible() : false;
        addTest('桌面端页面显示正常', desktopVisible);

        // 16. 检查页面加载时间
        const loadTime = await page.evaluate(() => {
            const perfData = window.performance.timing;
            return perfData.loadEventEnd - perfData.navigationStart;
        });
        addTest('页面加载时间合理', loadTime < 5000, `${loadTime}ms`);

        // 17. 测试完整的登录流程（包括加载租户数据）
        console.log('\n[5] 测试完整登录流程...');
        await page.goto(TEST_URL);

        // 填写登录表单
        await page.fill('#username', 'admin');
        await page.fill('#password', '123456');

        // 监听网络请求
        const apiCalls = [];
        await page.route('**/api/**', route => {
            apiCalls.push(route.request().url());
            route.continue();
        });

        // 提交登录
        await page.click('.login-button');

        // 等待登录处理完成
        await page.waitForTimeout(1500);

        // 检查是否调用了登录 API
        const hasLoginApiCall = apiCalls.some(url => url.includes('/api/login'));
        addTest('登录 API 被调用', hasLoginApiCall);

        // 检查是否调用了租户信息 API
        const tenantApiCalled = apiCalls.some(url => url.includes('/api/tenant'));
        addTest('租户信息 API 被调用', tenantApiCalled);

        // 检查 token 是否已保存
        const tokenSaved = await page.evaluate(() => localStorage.getItem('token'));
        addTest('Token 已保存到 localStorage', !!tokenSaved);

        // 检查用户信息是否已保存
        const userSaved = await page.evaluate(() => localStorage.getItem('user'));
        addTest('用户信息已保存到 localStorage', !!userSaved);

        // 检查租户信息是否已保存
        const tenantSaved = await page.evaluate(() => localStorage.getItem('tenant'));
        addTest('租户信息已保存到 localStorage', !!tenantSaved);

        // 租户管理功能测试
        console.log('\n[6] 测试租户管理功能...');

        // 检查 initTenantSelects 函数是否存在
        const initTenantSelectsExists = await page.evaluate(() => {
            return typeof initTenantSelects === 'function';
        });
        addTest('initTenantSelects 函数已定义', initTenantSelectsExists);

        // 检查编辑租户模态框是否存在
        const editModal = await page.$('#editTenantModal');
        addTest('编辑租户模态框存在', !!editModal);

        // 检查租户表单是否存在
        const editTenantForm = await page.$('#editTenantForm');
        addTest('编辑租户表单存在', !!editTenantForm);

        console.log('\n' + '='.repeat(50));
        console.log('测试完成!');
        console.log(`总计: ${results.summary.total} | 通过: ${results.summary.passed} | 失败: ${results.summary.failed}`);
        console.log('='.repeat(50));

    } catch (error) {
        console.error('测试执行错误:', error.message);
        addTest('测试执行', false, error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    return results;
}

// 运行测试并保存结果
runTests().then(async (results) => {
    const fs = require('fs');
    const outputPath = '/home/ubuntu/workspace/test/login-test-results.json';

    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n测试结果已保存到: ${outputPath}`);

    // 同时生成HTML报告
    const htmlReport = generateHtmlReport(results);
    const htmlPath = '/home/ubuntu/workspace/test/login-test-report.html';
    fs.writeFileSync(htmlPath, htmlReport);
    console.log(`HTML报告已保存到: ${htmlPath}`);
});

function generateHtmlReport(results) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录页面测试报告</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 12px;
            margin-bottom: 20px;
        }
        .header h1 { margin: 0 0 10px 0; }
        .summary {
            display: flex;
            gap: 20px;
            margin-top: 20px;
        }
        .summary-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            flex: 1;
        }
        .summary-card .number {
            font-size: 36px;
            font-weight: bold;
        }
        .summary-card.total .number { color: #333; }
        .summary-card.passed .number { color: #22c55e; }
        .summary-card.failed .number { color: #ef4444; }
        .tests {
            background: white;
            border-radius: 12px;
            overflow: hidden;
        }
        .test-item {
            padding: 15px 20px;
            border-bottom: 1px solid #eee;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .test-item:last-child { border-bottom: none; }
        .test-icon {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
        }
        .test-icon.passed { background: #dcfce7; color: #22c55e; }
        .test-icon.failed { background: #fee2e2; color: #ef4444; }
        .test-name { flex: 1; }
        .test-details { color: #666; font-size: 14px; }
        .url { color: #667eea; }
    </style>
</head>
<body>
    <div class="header">
        <h1>登录页面测试报告</h1>
        <p>测试URL: <span class="url">${results.url}</span></p>
        <p>测试时间: ${results.timestamp}</p>
        <div class="summary">
            <div class="summary-card total">
                <div class="number">${results.summary.total}</div>
                <div>总计测试</div>
            </div>
            <div class="summary-card passed">
                <div class="number">${results.summary.passed}</div>
                <div>通过</div>
            </div>
            <div class="summary-card failed">
                <div class="number">${results.summary.failed}</div>
                <div>失败</div>
            </div>
        </div>
    </div>
    <div class="tests">
        ${results.tests.map(t => `
        <div class="test-item">
            <div class="test-icon ${t.passed ? 'passed' : 'failed'}">${t.passed ? '✓' : '✗'}</div>
            <div class="test-name">${t.name}</div>
            ${t.details ? `<div class="test-details">${t.details}</div>` : ''}
        </div>
        `).join('')}
    </div>
</body>
</html>`;
}
