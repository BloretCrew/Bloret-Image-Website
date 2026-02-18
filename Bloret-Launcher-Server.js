const express = require('express');
const fs = require('fs');
const path = require('path');
const useragent = require('useragent');
const ini = require('ini');
const multer = require('multer');
const crypto = require('crypto');
const nsfwjs = require('nsfwjs');
const { createCanvas, loadImage } = require('canvas');
const cookieParser = require('cookie-parser');
const marked = require('marked');
const axios = require('axios');
// 引入 graphql-request 库以支持更便捷的 GraphQL 查询
const { request, gql } = require('graphql-request');
const app = express();

// 添加 express.json() 中间件来解析 JSON 格式的请求体
app.use(express.json());
app.use(cookieParser()); // 使用 cookie-parser 中间件

// 创建 log 文件夹（如果不存在）
const logDir = path.join(__dirname, 'log');
if (!fs.existsSync(logDir)){
    fs.mkdirSync(logDir);
}

// 创建日志文件
const logFilePath = path.join(logDir, `${new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '')}.log`);
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

// 重定向 console.log 输出到日志文件和控制台
const originalConsoleLog = console.log;
console.log = function(...args) {
    originalConsoleLog(...args);
    logStream.write(`${args.join(' ')}\n`);
};

// 读取 config.json 文件并解析
const configJsonFilePath = path.join(__dirname, 'config.json');
let configJson = JSON.parse(fs.readFileSync(configJsonFilePath, 'utf-8'));

let port = configJson.port ? parseInt(configJson.port, 10) : 2;
console.log(`从 config.json 中读取的端口值(port)为：${port}`);

let refreshInterval = configJson.loadtime;
console.log(`从 config.json 中读取的配置文件刷新延迟(loadtime)为：${refreshInterval} s`);
refreshInterval = refreshInterval * 1000;

let counter = 0;

// 读取 key 和 webhook.feishu-message
let key = configJson.key;
let webhookFeishu = configJson.webhook['feishu-message'];

// 读取 Bloret-Launcher-latest 的值
let bloretLauncherLatest = configJson['Bloret-Launcher-latest'];
let bloretLauncherUpdateText = configJson['Bloret-Launcher-update-text'];
let BloretLauncherlatestversion = configJson['Bloret-Launcher-latest-version']

// 读取 data.ini 中的 user 值
function readUserFromConfig() {
    const dataFilePath = path.join(__dirname, 'data.ini');
    const config = fs.readFileSync(dataFilePath, 'utf-8');
    const match = config.match(/user=(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
}

// 将 user 值写入 data.ini
function writeUserToConfig(user) {
    const dataFilePath = path.join(__dirname, 'data.ini');
    fs.writeFileSync(dataFilePath, `user=${user}`, 'utf-8');
}

console.log(`从 data.ini 中读取的 user 值为：${counter}`);

counter = readUserFromConfig();

const goConfig = configJson.go || {}; // 确保 goConfig 至少是一个空对象

// 输出 go 配置信息
for (const key in goConfig) {
    if (goConfig.hasOwnProperty(key)) {
        console.log(`已设定 /go/${key} 重定向到 ${goConfig[key]}`);
    }
}

app.use(checkBannedIP); // 确保封禁检查中间件在所有路由之前被调用

// 配置静态文件目录
app.use(express.static(path.join(__dirname, 'main')));

// 新增: 配置 style.css 和 base.css 的静态文件目录
app.use('/css', express.static(path.join(__dirname, 'css')));

// 中间件：记录访问信息
async function logAccess(req, res, next) {
    const ipAddress = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;

    const userAgent = req.headers['user-agent'];
    const agent = useragent.parse(userAgent); // 解析 user-agent 字符串

    // 获取当前时间并格式化
    const currentTime = new Date();
    const formattedTime = `${currentTime.getFullYear()}年${String(currentTime.getMonth() + 1).padStart(2, '0')}月${String(currentTime.getDate()).padStart(2, '0')}日 ${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}:${String(currentTime.getSeconds()).padStart(2, '0')}`;

    // const ipLocation = await getIpLocation(ipAddress); // 使用 await 等待 Promise 结果

    const logMessage = `有用户访问页面\n - 时间: ${formattedTime}\n - IP: ${ipAddress}\n - 访问页面: ${req.originalUrl}\n - 浏览器: ${agent.family} ${agent.major}.${agent.minor}.${agent.patch}\n - 操作系统: ${agent.os.family} ${agent.os.major}.${agent.os.minor}.${agent.os.patch}\n`;

    // 输出到控制台
    console.log(logMessage);

    next();
}

// 将 logAccess 中间件应用到所有路由
app.use(logAccess);

// 设置主页为 main/index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main', 'index.html'));
});

app.get('/api/bbs/type.json', (req, res) => {
    const typeFilePath = path.join(__dirname, 'bbs', 'type.json');
    try {
        const typeData = JSON.parse(fs.readFileSync(typeFilePath, 'utf-8'));
        res.json(typeData);
    } catch (error) {
        console.error('读取 type.json 文件失败:', error);
        res.status(500).send('读取 type.json 文件失败');
    }
});

app.use('/download', express.static(path.join(__dirname, 'download')));

app.get('/download', (req, res) => {
    const zipDir = path.join(__dirname, 'download');
    fs.readdir(zipDir, (err, files) => {
        if (err) {
            return res.status(500).send('无法读取文件列表');
        }

        let fileListHtml = '<html><head><title>文件列表</title></head><body>';
        fileListHtml += '<h1>文件列表</h1><ul>';

        files.forEach(file => {
            fileListHtml += `<li><a href="/download/${file}">${file}</a></li>`;
        });

        fileListHtml += '</ul></body></html>';
        res.send(fileListHtml);
    });
});

app.get('/api/blnum', (req, res) => {
    counter++;
    writeUserToConfig(counter);

    // 获取当前日期
    const currentDate = new Date().toISOString().split('T')[0];

    // 读取 BLuser.log.csv 文件内容
    const logFilePath = path.join(__dirname, 'BLuser.log.csv');
    let logData = '';
    if (fs.existsSync(logFilePath)) {
        logData = fs.readFileSync(logFilePath, 'utf-8');
    }

    // 将日志内容解析为数组
    const logLines = logData.split('\n').filter(line => line.trim() !== '');
    const logEntries = logLines.map(line => line.split(','));

    // 检查是否已有当前日期的记录
    const todayEntry = logEntries.find(entry => entry[0] === currentDate);
    if (todayEntry) {
        // 更新今日记录
        todayEntry[1] = (parseInt(todayEntry[1], 10) + 1).toString();
    } else {
        // 添加新记录
        logEntries.push([currentDate, '1']);
    }

    // 将更新后的日志写回文件
    const updatedLogData = logEntries.map(entry => entry.join(',')).join('\n');
    fs.writeFileSync(logFilePath, updatedLogData, 'utf-8');

    res.json({ user: counter });
});

app.get('/reset', (req, res) => {
    counter = 0;
    res.json({ message: 'Counter reset' });
});

app.get('/api/showbluser', (req, res) => {
    res.json({ user: counter });
});

app.get('/api/server', (req, res) => {
    res.json({ 'port': port, 'localip': 'http://localhost:' + port, 'publicip': 'http://pcfs.eno.ink:' + port });
});

// 新增 /go/:url 路由处理重定向
app.get('/go/:url', (req, res) => {
    const goConfig = configJson.go;
    const targetUrl = goConfig[req.params.url];

    if (targetUrl) {
        res.redirect(targetUrl);
    } else {
        res.status(404).send('重定向目标未找到');
    }
});

app.get('/api/loadtime', (req, res) => {
    const timeSinceLastRefresh = Date.now() - lastRefreshTime;
    const timeUntilNextRefresh = refreshInterval - timeSinceLastRefresh;
    const timeUntilNextRefreshSeconds = Math.ceil(timeUntilNextRefresh / 1000);
    res.json({ loadtime: timeUntilNextRefreshSeconds, unit: 'seconds' });
});

// 新增一个数组用于存储消息
let messages = [];

// 新增 /api/sendmessage 路由处理发送消息
app.get('/api/sendmessage', (req, res) => {
    const message = req.query.message;
    const messagekey = req.query.key;
    if (messagekey != key) {
        console.log('有人想要发送消息，但是 key 不正确');
        return res.status(403).send('key 不正确');
    }
    if (!message) {
        console.log('有人想要发送消息，但是缺少 message 参数');
        return res.status(400).send('缺少 message 参数');
    }

    axios.get(webhookFeishu, {
        params: {
            key: key,
            message: message
        }
    })
    .then(response => {
        console.log('消息发送成功:', response.data);
        console.log(`消息内容: ${message}`);
        res.json({ status: 'success', data: response.data });
    })
    .catch(error => {
        console.error('消息发送失败:', error);
        res.status(500).json({ status: 'error', message: '消息发送失败' });
    });
});

// 新增 /api/getmessage 路由处理获取消息
app.get('/api/getmessage', (req, res) => {
    const message = req.query.message;
    const messagekey = req.query.key;
    console.log(`接收到 /api/getmessage 请求，key: ${messagekey}, message: ${message}`); // 新增日志输出
    if (messagekey !== key) {
        console.log('获取消息，但是 key 不正确');
        return res.status(403).send('key 不正确');
    }
    if (!message) {
        console.log('获取消息，但是缺少 message 参数');
        return res.status(400).send('缺少 message 参数');
    }

    // 将 message 存入数组
    messages.push(message);
    console.log(`消息已存储: ${message}`); // 新增日志输出
    res.json({ status: 'success', message: '消息已存储' });
});

app.get('/api/showmessage', (req, res) => {
    const messagekey = req.query.key;
    if (messagekey !== key) {
        console.log('有人想要发送消息，但是 key 不正确');
        return res.status(403).send('key 不正确');
    }
    if (messages.length === 0) {
        res.json({ messages: '没有更多你未查看的消息了'});
        console.log(`消息已显示: 没有更多你未查看的消息了`);
    }else{
        res.json({ messages: messages });
        console.log(`消息已显示: ${messages}`);
    }
    messages = [];
});

// 新增 /api/part 路由处理 part.json 文件
app.get('/api/part', (req, res) => {
    const partFilePath = path.join(__dirname,'bbs','part.json');
    try {
        const partData = JSON.parse(fs.readFileSync(partFilePath, 'utf-8'));
        res.json(partData);
    } catch (error) {
        console.error('读取 part.json 文件失败:', error);
        res.status(500).send('读取 part.json 文件失败');
    }
});

// 新增 /api/register 路由处理注册请求
app.post('/api/register', (req, res) => {
    const { username, password, email } = req.body;

    // 在控制台展示 POST 请求内容
    console.log('接收到的注册请求:', req.body);

    // 这里可以添加更多的验证逻辑，例如检查用户名是否已存在等
    if (!username || !password || !email) {
        return res.status(400).json({ status: 'error', message: '用户名、密码和电子邮件都是必填项' });
    }

    // 验证电子邮件格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ status: 'error', message: '电子邮件格式不正确' });
    }

    // 读取 user.json 文件
    const userFilePath = path.join(__dirname, 'user.json');
    let users = [];
    if (fs.existsSync(userFilePath)) {
        try {
            const userData = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
            // 将对象转换为数组
            users = Object.values(userData);
        } catch (error) {
            console.error('读取 user.json 文件失败:', error);
            return res.status(500).json({ status: 'error', message: '服务器错误' });
        }
    }

    // 检查用户名是否已存在
    const userExists = users.some(user => user.username === username);
    if (userExists) {
        return res.status(400).json({ status: 'error', message: '用户名已存在' });
    }

    // 添加新用户
    users.push({ username: username, password: password, email: email, admin: false, github: "" });
    try {
        fs.writeFileSync(userFilePath, JSON.stringify(users.reduce((acc, user) => {
            acc[user.username] = user;
            return acc;
        }, {}), null, 2), 'utf-8');
    } catch (error) {
        console.error('写入 user.json 文件失败:', error);
        return res.status(500).json({ status: 'error', message: '服务器错误' });
    }

    console.log(`注册新用户: ${username}, ${email}`);

    // 注册成功后返回重定向 URL
    res.json({ status: 'success', message: '注册成功', redirectUrl: '/bbs/login' });
});

// 新增 /api/BL/info 路由
app.get('/api/BL/info', (req, res) => {
    const gitCodeLatestLinkSetup = `https://gitcode.com/Bloret/Bloret-Launcher/releases/download/${BloretLauncherlatestversion}/Bloret-Launcher-Setup.exe`;
    const gitCodeLatestLinkWindows = `https://gitcode.com/Bloret/Bloret-Launcher/releases/download/${BloretLauncherlatestversion}/Bloret-Launcher-Windows.zip`;

    res.json({
        'Bloret-Launcher-latest-version': BloretLauncherlatestversion,
        'Bloret-Launcher-update-text' : bloretLauncherUpdateText,
        'Bloret-Launcher-DownLoad-Link': {
            'Bloret-Launcher-Setup': {
                'GitCode': gitCodeLatestLinkSetup,
                'Bloret': 'https://launcher.bloret.net/download/Bloret-Launcher-Setup.exe',
                'Github': 'https://github.com/BloretCrew/Bloret-Launcher/releases/latest/download/Bloret-Launcher-Setup.exe'
            },
            'Bloret-Launcher-Windows': {
                'GitCode': gitCodeLatestLinkWindows,
                'Bloret': 'https://launcher.bloret.net/download/Bloret-Launcher-Windows.zip',
                'Github': 'https://github.com/BloretCrew/Bloret-Launcher/releases/latest/download/Bloret-Launcher-Windows.zip'
            }
        }
    });
});

app.listen(port, () => {
    console.log(`\nBloret-Launcher-Server 服务已经运行：\n    本地位于: http://localhost:${port}\n    外部位于: http://pcfs.eno.ink:${port}\nhttps://launcher.bloret.net/\n`);
});

async function getIpLocation(ip) {
    try {
        const response = await axios.get(`http://ip-api.com/json/${ip}?lang=zh-CN`);
        if (response.data && response.data.country) {
            return `${response.data.country} ${response.data.regionName} ${response.data.city} ${response.data.isp} ${response.data.org} ${response.data.as}`;
        } else {
            return "未知 或 请求失败";
        }
    } catch (error) {
        console.error(`获取 IP 属地信息失败: ${error}`);
        return "未知";
    }
}

// 新增 /api/BLlatest 路由处理返回 Bloret-Launcher-latest 的值
app.get('/api/BLlatest', (req, res) => {
    res.json({'Bloret-Launcher-latest': parseFloat(bloretLauncherLatest),'text': bloretLauncherUpdateText});
});
// 开放 /bbs 下的所有内容
app.use('/bbs', express.static(path.join(__dirname, 'bbs')));

// 动态路由处理帖子内容
app.get('/bbs/:partName/:postTitle', (req, res) => {
    const partName = decodeURIComponent(req.params.partName); // 解码板块名称
    const postTitle = decodeURIComponent(req.params.postTitle); // 解码帖子标题
    const partFilePath = path.join(__dirname, 'bbs', 'part.json');

    try {
        // 读取 part.json 文件
        const partData = JSON.parse(fs.readFileSync(partFilePath, 'utf-8'));

        // 检查板块是否存在
        if (!partData[partName]) {
            return res.status(404).send(`板块 "${partName}" 未找到`);
        }

        // 查找帖子内容
        const posts = partData[partName];
        const postContent = posts.find(p => p.title === postTitle);

        if (postContent) {
            // 确保 tags 存在并为数组
            const tags = Array.isArray(postContent.tags) ? postContent.tags : [];

            // 返回帖子内容的 HTML 页面
            // 使用 marked 库将 Markdown 转为 HTML
            const postHtml = marked.parse(postContent.text || '');

            res.send(`
                <!DOCTYPE html>
                <html lang="zh-CN">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>${postContent.title} - Bloret BBS</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; background-color: #f9f9f9; }
                        h1 { margin-bottom: 10px; }
                        .post-tags { color: #666; padding: 5px 10px; background-color: #f0f0f0; border-radius: 20px; font-size: 0.9em; display: inline-block; margin-right: 5px; margin-bottom: 10px; }
                        /* Markdown 基本样式 */
                        .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin-top: 1em; }
                        .markdown-body pre { background: #f6f8fa; padding: 10px; border-radius: 4px; overflow-x: auto; }
                        .markdown-body code { background: #f6f8fa; padding: 2px 4px; border-radius: 3px; }
                        .markdown-body blockquote { color: #555; border-left: 4px solid #ddd; margin: 1em 0; padding-left: 1em; }
                        .markdown-body ul, .markdown-body ol { margin-left: 2em; }
                    </style>
                </head>
                <body>
                    <h1>${postContent.title}</h1>
                    <div>${tags.map(tag => `<span class="post-tags">${tag}</span>`).join('')}</div>
                    <div class="markdown-body">${postHtml}</div>
                    <p><strong>作者:</strong> ${postContent.author}</p>
                    <p><strong>发布时间:</strong> ${postContent.time}</p>
                </body>
                </html>
            `);
        } else {
            res.status(404).send(`帖子 "${postTitle}" 未找到`);
        }
    } catch (error) {
        console.error('读取 part.json 文件失败:', error);
        res.status(500).send('服务器错误');
    }
});
// 新增 /api/bbs/sendpost 路由处理发送帖子
app.post('/api/bbs/sendpost', (req, res) => {
    const { partName, title, text, tags, author, time } = req.body;

    // 检查请求体是否包含必要字段
    if (!partName || !title || !text || !author || !time) {
        return res.status(400).json({ error: '请求体缺少必要字段' });
    }

    const partFilePath = path.join(__dirname, 'bbs', 'part.json');

    try {
        // 读取现有的 part.json 文件
        const partData = JSON.parse(fs.readFileSync(partFilePath, 'utf-8'));

        // 如果板块不存在，则创建新板块
        if (!partData[partName]) {
            partData[partName] = [];
        }

        // 添加新帖子到板块
        partData[partName].push({ title, text, tags, author, time });

        // 写入更新后的数据到 part.json 文件
        fs.writeFileSync(partFilePath, JSON.stringify(partData, null, 2), 'utf-8');

        res.json({ status: 'success', message: '帖子发送成功' });
    } catch (error) {
        console.error('写入帖子数据失败:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 设置 /img 路由处理静态文件
app.use('/img', express.static(path.join(__dirname, 'img')));

// 设置 /image 路由处理 img.html 文件
app.get('/image', (req, res) => {
    res.sendFile(path.join(__dirname, 'img.html'));
});
// 设置 multer 存储引擎
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, 'temp')); // 先存放在临时文件夹
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

// 文件过滤器，校验是否为图片文件
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('仅支持上传图片文件'));
    }
};

// 修改：使用 array() 方法处理多文件上传，对应 input 的 name "files"
const upload = multer({
    storage: storage,
    fileFilter: fileFilter
}).array('files');

// 新增: 加载 nsfwjs 模型
let model;
nsfwjs.load().then((loadedModel) => {
    model = loadedModel;
});

// 更新: 检测图片是否为成人内容的函数，添加调试日志及更多成人类别和更低的阈值
async function isImageAdult(imagePath) {
    try {
        const image = await loadCustomImage(imagePath);
        if (!model) {
            throw new Error("NSFWJS 模型未加载");
        }
        const predictions = await model.classify(image);
        console.log("图片审核预测结果:", predictions);
        // 设定需要拦截的成人类别
        const adultClasses = ['Porn', 'Hentai', 'Sexy'];
        const adultPrediction = predictions.find(p => adultClasses.includes(p.className));
        // 可根据实际情况进一步调整阈值，此处设为 0.3
        return adultPrediction && adultPrediction.probability > 0.3;
    } catch (error) {
        console.error("图片审核失败:", error);
        throw error;
    }
}

// 修改: 加载图片辅助函数：返回 canvas 而非直接返回 Image 对象
async function loadCustomImage(filePath) {
    try {
        const image = await loadImage(filePath);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return canvas;
    } catch (error) {
        throw new Error(`无法加载图片: ${filePath}`);
    }
}

// 新增 /api/imgupload 路由处理图片上传
app.post('/api/imgupload', (req, res) => {
    upload(req, res, async function (err) {
        if (err) {
            console.error('文件上传失败:', err);
            return res.status(400).json({ status: 'error', message: err.message });
        }

        const ipAddress = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;

        for (const file of req.files) {
            try {
                // 新增: 检测图片是否为成人内容
                const isAdult = await isImageAdult(file.path);
                if (isAdult) {
                    console.log('\x1b[31m%s\x1b[0m', `检测到成人内容，上传者IP: ${ipAddress}`);
                }

                const hash = crypto.createHash('md5').update(fs.readFileSync(file.path)).digest('hex');
                const newFilename = `${hash}${path.extname(file.originalname)}`;
                const newDir = isAdult ? 'warnimg' : 'img';
                const newPath = path.join(__dirname, newDir, newFilename);

                if (isAdult) {
                    fs.appendFileSync(path.join(__dirname, 'warnlog.txt'), `${ipAddress} - ${newFilename}\n`);
                }

                fs.renameSync(file.path, newPath);
                file.filename = newFilename;
                file.path = newPath;
            } catch (error) {
                console.error('图片审核失败:', error);
                fs.unlinkSync(file.path); // 删除临时文件
                return res.status(500).json({ status: 'error', message: '图片审核失败' });
            }
        }

        const uploadedFiles = req.files.map(file => file.filename);
        console.log('文件上传成功:', uploadedFiles);
        res.json({ status: 'success', message: '文件上传成功', filenames: uploadedFiles });
    });
});

app.use('/PCFS.jpg', express.static(path.join(__dirname, 'PCFS.jpg')));
app.use('/error', express.static(path.join(__dirname, 'error')));
// 封禁检查中间件
function checkBannedIP(req, res, next) {
    if (req.path === '/error/bloret.ico') {
        return next();
    }
    if (req.path === '/error/style.css') {
        return next();
    }
    if (req.path === '/error/base.css') {
        return next();
    }
    if (req.path === '/error/Rhedar-banned.png') {
        return next();
    }
    const ipAddress = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    const configJson = JSON.parse(fs.readFileSync(configJsonFilePath, 'utf-8'));
    const bannedList = configJson.banned;

    if (bannedList && bannedList[ipAddress]) {
        const banInfo = bannedList[ipAddress];
        const currentTime = Date.now();
        
        console.log(`IP ${ipAddress} 检查结果: 被封禁. 详情: 封禁原因: ${banInfo.message}, 开始时间: ${new Date(banInfo.start).toISOString()}, 结束时间: ${new Date(banInfo.end).toISOString()}`);
        return res.status(403).sendFile(path.join(__dirname, 'error', 'banned.html'));
    } else {
        console.log(`IP ${ipAddress} 检查结果: 未被封禁.`);
    }
    next();
}

function login(name, password) {
    const userFilePath = path.join(__dirname, 'user.json');
    let users = {};

    if (fs.existsSync(userFilePath)) {
        try {
            users = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
        } catch (error) {
            console.error('读取 user.json 文件失败:', error);
            return { status: false, message: '服务器错误' };
        }
    }

    if (!users[name]) {
        return { status: false, message: '用户不存在' };
    }

    if (users[name].password !== password) {
        return { status: false, message: '密码错误' };
    }

    return { status: true, name: users[name].name , password: users[name].password,  admin: users[name].admin };
}

app.get('/api/login', (req, res) => {
    const { name, password } = req.query; // 移到函数开头
    const result = login(name, password);

    if (!result.status) {
        return res.status(403).json({ status: false, message: result.message });
    }

    res.json({ status: true, name: result.name, admin: result.admin });
});

// 新增 /api/checkadmin 路由处理检查用户是否为管理员
app.get('/api/checkadmin', (req, res) => {
    const { username } = req.query;

    // 读取 user.json 文件
    const userFilePath = path.join(__dirname, 'user.json');
    let users = {};
    if (fs.existsSync(userFilePath)) {
        try {
            users = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
        } catch (error) {
            console.error('读取 user.json 文件失败:', error);
            return res.status(500).json({ status: 'error', message: '服务器错误' });
        }
    }

    // 检查用户名是否存在
    if (!users[username]) {
        return res.status(404).json({ status: false, message: '用户不存在' });
    }

    // 检查用户是否为管理员
    const isAdmin = users[username].admin === true;

    // 返回结果
    res.json({ [username]: isAdmin });
});

// 路由处理文件数量统计
app.get('/api/imgs', async (req, res) => {
    try {
        const imgCount = await getCount('img');
        const warnImgCount = await getCount('warnimg');
        res.json({ img: imgCount, warnimg: warnImgCount });
    } catch (err) {
        console.error('获取文件数量失败:', err);
        res.status(500).json({ error: '无法获取文件数量' });
    }
});

// 获取指定目录下的文件数量
async function getCount(directory) {
    const dirPath = path.join(__dirname, directory);
    try {
        const files = await fs.promises.readdir(dirPath);
        return files.length;
    } catch (err) {
        if (err.code === 'ENOENT') {
            return 0;
        }
        throw err;
    }
}

// 新增 fetchWikiPages 函数以获取维基目录
async function fetchWikiPages() {
    const url = 'https://wiki.bloret.net/graphql';
    
    const query = gql`
        query GetPages {
            pages {
                list {
                    id
                    path
                    title
                }
            }
        }
    `;

    try {
        const data = await request(url, query);
        
        if (data?.pages?.list) {
            return data.pages.list; // 返回维基目录列表
        } else {
            console.error('无法获取维基目录');
            return null;
        }
    } catch (error) {
        console.error(`请求失败: ${error.message}`);
        if (error.response) {
            // 服务器响应错误
            console.error('状态码:', error.response.status);
            console.error('响应内容:', error.response.data);
        } else if (error.request) {
            // 没有收到响应
            console.error('未收到服务器响应');
        } else {
            // 其他错误
            console.error('请求配置异常:', error.config);
        }
        return null;
    }
}

// 修改 fetchWikiPageById 函数以匹配 API 实际响应结构
async function fetchWikiPageById(pageId) {
    const url = 'https://wiki.bloret.net/graphql';
        
    const query = gql`
            query GetPages {
                pages {
                    list {
                        id
                        path
                        title
                    }
                }
            }
        `;

    try {
        const data = await request(url, query);
            
        // 查找与 pageId 匹配的页面内容
        const matchingPage = data?.pages?.list?.find(page => page.id === pageId);
            
        if (matchingPage) {
            return `找到 ID 为 ${pageId} 的页面：标题 - ${matchingPage.title}, 路径 - ${matchingPage.path}`; // 返回匹配页面的基本信息
        } else {
            return `未找到 ID 为 ${pageId} 的页面`;
        }
    } catch (error) {
        console.error(`请求失败: ${error.message}`);
        if (error.response) {
                // 服务器响应错误
                console.error('状态码:', error.response.status);
                console.error('响应内容:', error.response.data);
            } else if (error.request) {
                // 没有收到响应
                console.error('未收到服务器响应');
            } else {
                // 其他错误
                console.error('请求配置异常:', error.config);
            }
            return null;
        }
}

// 处理 GitHub 登录
app.get('/api/bbs/githublogin', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ status: 'error', message: '缺少 code 参数' });
    }

    const url = 'https://github.com/login/oauth/access_token';
    const data = {
        client_id: 'Ov23li6yN3H95OtAmPEk',
        client_secret: '1428050c8f6ab1aa723444e35fe3db09e4cf1865',
        code: code
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                Accept: 'application/json'
            }
        });

        console.log('GitHub 登录返回信息:', response.data);
        const accessToken = response.data.access_token;

        if (!accessToken) {
            return res.status(400).json({ status: 'error', message: '未能获取 access_token' });
        }
        
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: {
                Authorization: `token ${accessToken}`
            }
        });

        console.log('GitHub 用户信息:', userResponse.data);

        // 读取 user.json 文件
        const userFilePath = path.join(__dirname, 'user.json');
        let users = {};
        if (fs.existsSync(userFilePath)) {
            try {
            users = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
            } catch (error) {
            console.error('读取 user.json 文件失败:', error);
            return res.status(500).json({ status: 'error', message: '服务器错误' });
            }
        }

        // 查找与 github id 对应的用户
        const user = Object.values(users).find(user => user.github === userResponse.data.id);
        
        console.log('找到的用户信息:', user);
        console.log('用户的 GitHub ID:', userResponse.data.id);
        console.log('用户的 GitHub 名称:', userResponse.data.name);
        console.log(typeof(user));

        if (typeof(user) !== "undefined") {
            // 设置 cookies
            res.cookie('username', user.username, { expires: new Date(Date.now() + 31536000000) }); // 有效期一年
            res.cookie('password', user.password, { expires: new Date(Date.now() + 31536000000) });
            res.cookie('admin', user.admin, { expires: new Date(Date.now() + 31536000000) });
            res.redirect('/bbs');
        } else {
            console.log('未找到对应用户');
            // 未找到对应用户，检查 cookies 中是否有数据
            console.log('Cookies:', req.cookies);
            if (req.cookies && req.cookies.username && req.cookies.password) {
                console.log('cookies 有数据');
                const username = req.cookies.username;
                const password = req.cookies.password;
                
                console.log('Cookies 中的用户名:', username);
                console.log('Cookies 中的密码:', password);

                try {
                    const currentHost = req.get('host');
                    const loginUrl = `http://${currentHost}/api/login`;
                    const loginResponse = await axios.get(loginUrl, {
                        params: { name: username, password: password }
                    });

                    if (loginResponse.data.status) {
                        // 登录成功，将 GitHub ID 存入 user.json
                        users[username].github = userResponse.data.id;
                        fs.writeFileSync(userFilePath, JSON.stringify(users, null, 2), 'utf-8');
                        console.log(`GitHub ID 已绑定到用户 ${username}`);
                        res.redirect('/bbs');
                    } else {
                        res.redirect('/bbs/login');
                    }
                } catch (error) {
                    console.error('登录验证失败:', error);
                    res.redirect('/bbs/login');
                }
            } else {
                res.redirect('/bbs/login');
            }
        }
    } catch (error) {
        console.error('GitHub 登录失败:', error);
        res.redirect('/bbs/login');
    }
});
// 处理 飞书 登录
app.get('/oauth/lark', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ status: 'error', message: '缺少 code 参数' });
    }

    const url = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
    const data = {
        grant_type : 'authorization_code',
        client_id: 'cli_a894c1d2d2f9d00b',
        client_secret: 'IvM0WRvKrzoSflI5DrTt7blY1wGYC6fc',
        code: code,
        redirect_uri: 'https://launcher.bloret.net/oauth/lark'  // 确保这里的 redirect_uri 与授权时使用的一致
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                Accept: 'application/json'
            }
        });

        console.log('飞书 登录返回信息:', response.data);
        const accessToken = response.data.access_token;
        
        if (response.data.code != 0) {
            return res.status(400).json({ status: 'error', message: '请求失败。' });
        }

        if (!accessToken) {
            return res.status(400).json({ status: 'error', message: '未能获取 access_token' });
        }
        
        const userResponse = await axios.get('https://open.feishu.cn/open-apis/authen/v1/user_info', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        console.log('飞书 用户信息:', userResponse.data.data);

        // 读取 user.json 文件
        const userFilePath = path.join(__dirname, 'user.json');
        let users = {};
        if (fs.existsSync(userFilePath)) {
            try {
            users = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
            } catch (error) {
            console.error('读取 user.json 文件失败:', error);
            return res.status(500).json({ status: 'error', message: '服务器错误' });
            }
        }

        // 查找与 lark id 对应的用户
        const user = Object.values(users).find(user => user.lark === userResponse.data.data.open_id);
        
        console.log('找到的用户信息:', user);
        console.log('用户的 Lark ID:', userResponse.data.data.open_id);
        console.log('用户的 Lark 名称:', userResponse.data.data.name);
        console.log(typeof(user));

        if (typeof(user) !== "undefined") {
            // 设置 cookies
            res.cookie('username', user.username, { expires: new Date(Date.now() + 31536000000) }); // 有效期一年
            res.cookie('password', user.password, { expires: new Date(Date.now() + 31536000000) });
            res.cookie('admin', user.admin, { expires: new Date(Date.now() + 31536000000) });
            res.redirect('/bbs');
        } else {
            console.log('未找到对应用户');
            // 未找到对应用户，检查 cookies 中是否有数据
            console.log('Cookies:', req.cookies);
            if (req.cookies && req.cookies.username && req.cookies.password) {
                console.log('cookies 有数据');
                const username = req.cookies.username;
                const password = req.cookies.password;
                
                console.log('Cookies 中的用户名:', username);
                console.log('Cookies 中的密码:', password);

                try {
                    const currentHost = req.get('host');
                    const loginUrl = `http://${currentHost}/api/login`;
                    const loginResponse = await axios.get(loginUrl, {
                        params: { name: username, password: password }
                    });

                    if (loginResponse.data.status) {
                        // 登录成功，将 Lark ID 存入 user.json
                        users[username].lark = userResponse.data.data.open_id;
                        console.log(`userResponse.data.data.open_id: ${userResponse.data.data.open_id}, users[username].lark: ${users[username].lark}`);
                        fs.writeFileSync(userFilePath, JSON.stringify(users, null, 2), 'utf-8');
                        console.log(`Lark ID 已绑定到用户 ${username}`);
                        res.redirect('/bbs');
                    } else {
                        res.redirect('/bbs/login');
                    }
                } catch (error) {
                    console.error('登录验证失败:', error);
                    res.redirect('/bbs/login');
                }
            } else {
                res.redirect('/bbs/login');
            }
        }
    } catch (error) {
        console.error('飞书 登录失败:', error);
        res.redirect('/bbs/login');
    }
});
// /api/bloret-version 路由处理返回 Bloret-versions 的值
app.get('/api/bloret-version', (req, res) => {
    const bloretVersions = configJson['Bloret-versions'];
    if (bloretVersions) {
        res.json({ 'Bloret-versions': bloretVersions });
    } else {
        res.status(404).json({ status: 'error', message: 'Bloret-versions 未找到' });
    }
});

// /api/Light-Minecraft-Download-Way 路由处理返回 Light-Minecraft-Download-Way 的值
app.get('/api/Light-Minecraft-Download-Way', (req, res) => {
    const LightMinecraftDownloadWay = configJson['Light-Minecraft-Download-Way'];
    if (LightMinecraftDownloadWay) {
        res.json({ 'Light-Minecraft-Download-Way': LightMinecraftDownloadWay });
    } else {
        res.status(404).json({ status: 'error', message: 'Light-Minecraft-Download-Way 未找到' });
    }
});

// 修改折线图标题和字体设置
app.get('/api/BL/madeuserpic', (req, res) => {
    const logFilePath = path.join(__dirname, 'BLuser.log.csv');

    if (!fs.existsSync(logFilePath)) {
        return res.status(404).send('BLuser.log.csv 文件不存在');
    }

    const logData = fs.readFileSync(logFilePath, 'utf-8');
    const logLines = logData.split('\n').filter(line => line.trim() !== '' && !line.startsWith('日期'));
    const logEntries = logLines.map(line => {
        const [date, count] = line.split(',');
        return { date, count: parseInt(count, 10) };
    });

    const canvasWidth = 800;
    const canvasHeight = 400;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // 绘制背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 设置样式
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.font = '12px Cascadia Mono';

    // 修改标题字体为支持中文的字体，例如 Microsoft YaHei
    ctx.font = '16px Microsoft YaHei';
    ctx.fillText('Bloret Launcher 实时新增使用人数', canvasWidth / 2 - ctx.measureText('Bloret Launcher 实时新增使用人数').width / 2, 30);

    // 计算坐标系
    const padding = 50;
    const chartWidth = canvasWidth - 2 * padding;
    const chartHeight = canvasHeight - 2 * padding;

    const dates = logEntries.map(entry => entry.date);
    const counts = logEntries.map(entry => entry.count);
    const maxCount = Math.max(...counts);

    // 绘制坐标轴
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, canvasHeight - padding);
    ctx.lineTo(canvasWidth - padding, canvasHeight - padding);
    ctx.stroke();

    // 绘制横坐标日期
    const dateStep = chartWidth / (dates.length - 1);
    dates.forEach((date, index) => {
        const x = padding + index * dateStep;
        const y = canvasHeight - padding;
        ctx.fillText(date, x - ctx.measureText(date).width / 2, y + 20);
    });

    // 绘制纵坐标刻度
    const countStep = chartHeight / maxCount;
    for (let i = 0; i <= maxCount; i += Math.ceil(maxCount / 10)) {
        const x = padding;
        const y = canvasHeight - padding - i * countStep;
        ctx.fillText(i.toString(), x - 30, y + 5);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + chartWidth, y);
        ctx.strokeStyle = '#e0e0e0';
        ctx.stroke();
    }

    // 绘制折线图
    ctx.beginPath();
    logEntries.forEach((entry, index) => {
        const x = padding + index * dateStep;
        const y = canvasHeight - padding - entry.count * countStep;
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        // 添加数据标签
        ctx.fillStyle = '#000000';
        ctx.fillText(entry.count.toString(), x - 10, y - 10);
    });
    ctx.strokeStyle = '#ff0000';
    ctx.stroke();

    // 返回图片
    res.setHeader('Content-Type', 'image/png');
    canvas.createPNGStream().pipe(res);
});

app.use('/game', express.static(path.join(__dirname, 'Game')));

app.post('/webhook/github/BloretCrew/Bloret-Launcher', (req, res) => {
    const githubEventType = req.headers['x-github-event']; // 获取 GitHub Webhook 事件类型

    console.log(`接收到的 GitHub Webhook 请求类型: ${githubEventType}`);
    console.log('请求体:', req.body);

    // 可以根据事件类型做不同处理
    switch (githubEventType) {
        case 'push':
            console.log('Push event detected');
            console.log(`提交者: ${data.pusher.name}, 分支: ${data.ref}`);
            res.json({ status: 'success', title: 'Push 事件', user: data.pusher.name ,text: data.ref})
            break;
        case 'pull_request':
            console.log('Pull Request event detected');
            console.log(`PR 标题: ${data.pull_request.title}, 状态: ${data.action}`);
            res.json({ status: 'success', title: data.pull_request.title, user: 'user' ,text: data.action})
            break;
        case 'release':
            console.log('Release event detected');
            console.log(`发布版本: ${data.release.tag_name}, 名称: ${data.release.name}`);
            res.json({ status: 'success', title: data.release.name, user: 'user' ,text: data.release.tag_name})
            break;
        case 'issue':
            console.log('Issue event detected');
            console.log(`Issue 标题: ${data.issue.title}, 状态: ${data.action}`);
            res.json({ status: 'success', title: data.issue.title, user: 'user' ,text: data.action})
            break;
        default:
            console.log('未知事件类型');
            res.json({ status: 'error', message: '未知事件类型' })
    }

    res.json({ status: 'success', message: 'Webhook received' });
});

// 用于存储已分配的数字和token的映射关系
const assignedNumbers = new Map();

// 用于存储已使用的数字集合
const usedNumbers = new Set();

// 生成10000-20000范围内未使用的数字
function generateUniqueNumber() {
    // 首先检查是否还有可用数字
    if (usedNumbers.size >= 10001) {
        throw new Error('所有数字都已被使用');
    }
    
    // 简单方法：从10000开始依次分配未使用的数字
    for (let i = 10000; i <= 20000; i++) {
        if (!usedNumbers.has(i)) {
            usedNumbers.add(i);
            return i;
        }
    }
    
    // 如果循环没有找到可用数字，则抛出错误
    throw new Error('无法找到未使用的数字');
}

// /api/minecraft-online-client 路由处理
app.get('/api/minecraft-online-client', (req, res) => {
    const { token } = req.query;
    
    // 检查是否提供了token参数
    if (!token) {
        return res.status(400).json({ status: false, message: '缺少 token 参数' });
    }
    
    // 从配置文件中读取token进行验证
    const configToken = configJson['frp-token'];
    if (!configToken) {
        return res.status(500).json({ status: false, message: '服务器未配置访问令牌' });
    }
    
    // 验证token是否匹配
    if (token !== configToken) {
        return res.status(403).json({ status: false, message: 'token 无效' });
    }
    
    try {
        // 生成一个新的唯一数字
        const number = generateUniqueNumber();
        
        // 返回结果
        res.json({ 
            status: true, 
            port: number,
            message: '成功分配端口'
        });
    } catch (error) {
        res.status(500).json({ 
            status: false, 
            message: error.message 
        });
    }
});

app.post('/api/ai/post', (req, res) => {
    // ```
    //  api > ai > post
    
    //  请求示例：{
    //     "name":"player",
    //     "text":"你帮我去 Minecraft wiki 找找 橡木原木 是哪个版本加入 Minecraft 的",
    //     "messages":[
    //         { 
    //             "role": "user", 
    //             "content": "你好啊"
    //         },
    //         { 
    //             "role": "assistant", 
    //             "content": "**你好呀~** 我是络可，百络谷的小画家。最喜欢画漂亮的建筑和小动物。有什么我可以帮你的吗？"
    //         }
    //     ]
    //  }
    //  返回示例：{
    //     "status": true, 
    //     "ask2": true, 
    //     "content": "**稍等**~我帮你找找哦。↵↵*[络可正在翻看 Minecraft Wiki...]*↵↵橡木原木… 的 **1.0.0 版本** 中加入的。这是游戏最初版本的基础木材类型，也是最早出现的木材之一。"
    //  }
    // ```
    console.log(req.headers);
    console.log(req.body);

    // 从 config.json 中读取 key
    const configJson = JSON.parse(fs.readFileSync(configJsonFilePath, 'utf-8'));
    const expectedKey = configJson.key;
    const ai_key = configJson.ai_key;

    // 获取请求中的 key
    const requestKey = req.headers['key'];

    // 验证 key 是否正确
    if (!requestKey || requestKey !== expectedKey) {
        return res.status(403).json({ error: '无效或缺失的 key' });
    }

    let prompt; // 声明 prompt 变量
    const model = req.headers['model']; // 提前获取 model

    if (req.headers['prompt']) {
        prompt = req.headers['prompt'];
    } else {
        // 添加对 configJson['ai'][model] 是否存在的校验
        if (!configJson['ai']) {
            return res.status(500).json({ error: '配置文件 ai 节点不存在' });
        }
        if (!configJson['ai'][model]) {
            return res.status(400).json({ error: '模型配置不存在' });
        }
        prompt = configJson['ai'][model]['prompt'];
    }

    // 处理多行文本，将换行符转换为 \n
    const processedText = req.body.text ? req.body.text.replace(/\n/g, "\\n") : "";

    if(configJson['ai'][model]['usertell']){
        ask = { role: "user", content: `${processedText}` }
    }else{
        ask = { role: "user", content: `${req.body.name}说: ${processedText}` }
    }

    // 确保 req.body.messages 是一个数组，如果不存在或不是数组则使用空数组
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];

    // 构建初始请求体
    const initialRequestBody = {
        model: "Qwen/Qwen3-8B",
        stream: false,
        max_tokens: 512,
        enable_thinking: false,
        thinking_budget: 4096,
        min_p: 0.05,
        temperature: 0.7,
        top_p: 0.7,
        top_k: 50,
        frequency_penalty: 0.5,
        n: 1,
        stop: [],
        messages: [
            { role: "system", content: prompt },
            // 将请求时输入的 messages 数组插入这里
            ...messages,
            ask
        ],
        tools: []
    };

    const options = {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${ai_key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(initialRequestBody)
    };

    console.log('请求 Body:', JSON.stringify(initialRequestBody, null, 2));

    fetch('https://api.siliconflow.cn/v1/chat/completions', options)
        .then(response => response.json())
        .then(async response => {
            console.log('AI 接口返回:', response);

            if (
                response &&
                Array.isArray(response.choices) &&
                response.choices.length > 0 &&
                response.choices[0]?.message?.content
            ) {
                const content = response.choices[0].message.content;

                // 判断是否需要 wiki 查询
                if (
                    content.includes("${wiki}") &&
                    configJson['ai'][model]['wikisearch']
                ) {
                    console.log("内容包含 ${wiki} 标记，且配置允许 wiki 查询，开始处理...");
                    const regex = /\(([^)]+)\)/g;
                    let match;
                    const wikiContents = {};

                    while ((match = regex.exec(content)) !== null) {
                        const keyword = match[1];
                        
                        try {
                            const wikiUrl = `https://zh.minecraft.wiki/w/${encodeURIComponent(keyword)}`;
                            const wikiResponse = await axios.get(wikiUrl);
                            
                            // 提取页面中的中文字符
                            const textOnly = wikiResponse.data.replace(/<[^>]+>/g, '');
                            const chineseCharacters = textOnly.match(/[一-龥]/g);
                            
                            // 安全处理匹配结果
                            wikiContents[keyword] = chineseCharacters ? chineseCharacters.join("") : "";
                        } catch (error) {
                            wikiContents[keyword] = `无法获取数据: ${error.message}`;
                        }
                    }

                    // 构建第二次请求体
                    const secondRequestBody = {
                        model: "Qwen/Qwen3-8B",
                        stream: false,
                        max_tokens: 512,
                        enable_thinking: false,
                        thinking_budget: 4096,
                        min_p: 0.05,
                        temperature: 0.7,
                        top_p: 0.7,
                        top_k: 50,
                        frequency_penalty: 0.5,
                        n: 1,
                        stop: [],
                        messages: [
                            { role: "system", content: prompt },
                            { role: "user", content: `${req.body.name}说: ${processedText}` },
                            { role: "assistant", content: content },
                            {
                                role: "user",
                                content: `${JSON.stringify(wikiContents).replace(/"/g, "'")}，以上是你要查询的 mcwiki 数据，请继续回答问题：${req.body.name}说: ${processedText}`
                            }
                        ],
                        tools: []
                    };

                    const secondOptions = {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${ai_key}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(secondRequestBody)
                    };

                    console.log('二次请求 Body:', JSON.stringify(secondRequestBody, null, 2));

                    fetch('https://api.siliconflow.cn/v1/chat/completions', secondOptions)
                        .then(response2 => response2.json())
                        .then(response2 => {
                            console.log('二次请求结果:', JSON.stringify(response2, null, 2));
                            if (
                                response2 &&
                                Array.isArray(response2.choices) &&
                                response2.choices.length > 0 &&
                                response2.choices[0]?.message?.content
                            ) {
                                const finalContent = content.replace(/\$\{wiki\}[\s\S]*?\$\{\/wiki\}/, '\n*[络可正在翻看 Minecraft Wiki...]*\n') +
                                    '\n' + response2.choices[0].message.content;

                                return res.json({
                                    status: true,
                                    ask2: true,
                                    content: finalContent
                                });
                            } else {
                                return res.status(500).json({
                                    status: false,
                                    ask2: true,
                                    error: '无法从第二次 AI 请求中获取有效内容'
                                });
                            }
                        })
                        .catch(err => {
                            console.error('AI 接口调用失败:', err.message);
                            return res.status(500).json({ error: `请求失败: ${err.message}` });
                        });

                } else {
                    return res.json({
                        status: true,
                        ask2: false,
                        content: content
                    });
                }
            } else {
                return res.status(500).json({ error: '无法获取有效响应内容' });
            }
        })
        .catch(err => {
            console.error('AI 接口第一次调用失败:', err.message);
            return res.status(500).json({ error: '请求失败' });
        });
});


// 开放 /chafuwang 下的所有内容
app.use('/chafuwang', express.static(path.join(__dirname, 'chafuwang')));
// 动态路由处理帖子内容
// app.get('/chafuwang/:partName/:postTitle', (req, res) => {
//     const partName = decodeURIComponent(req.params.partName); // 解码板块名称
//     const postTitle = decodeURIComponent(req.params.postTitle); // 解码帖子标题
//     const partFilePath = path.join(__dirname, 'chafuwang', 'part.json');

//     try {
//         // 读取 part.json 文件
//         const partData = JSON.parse(fs.readFileSync(partFilePath, 'utf-8'));

//         // 检查板块是否存在
//         if (!partData[partName]) {
//             return res.status(404).send(`板块 "${partName}" 未找到`);
//         }

//         // 查找帖子内容
//         const posts = partData[partName];
//         const postContent = posts.find(p => p.title === postTitle);

//         if (postContent) {
//             // 确保 tags 存在并为数组
//             const tags = Array.isArray(postContent.tags) ? postContent.tags : [];

//             // 返回帖子内容的 HTML 页面
//             // 使用 marked 库将 Markdown 转为 HTML
//             const postHtml = marked.parse(postContent.text || '');

//             res.send(`
//                 <!DOCTYPE html>
//                 <html lang="zh-CN">
//                 <head>
//                     <meta charset="UTF-8">
//                     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//                     <title>${postContent.title} - Bloret BBS</title>
//                     <style>
//                         body { font-family: Arial, sans-serif; padding: 20px; background-color: #f9f9f9; }
//                         h1 { margin-bottom: 10px; }
//                         .post-tags { color: #666; padding: 5px 10px; background-color: #f0f0f0; border-radius: 20px; font-size: 0.9em; display: inline-block; margin-right: 5px; margin-bottom: 10px; }
//                         /* Markdown 基本样式 */
//                         .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin-top: 1em; }
//                         .markdown-body pre { background: #f6f8fa; padding: 10px; border-radius: 4px; overflow-x: auto; }
//                         .markdown-body code { background: #f6f8fa; padding: 2px 4px; border-radius: 3px; }
//                         .markdown-body blockquote { color: #555; border-left: 4px solid #ddd; margin: 1em 0; padding-left: 1em; }
//                         .markdown-body ul, .markdown-body ol { margin-left: 2em; }
//                     </style>
//                 </head>
//                 <body>
//                     <h1>${postContent.title}</h1>
//                     <div>${tags.map(tag => `<span class="post-tags">${tag}</span>`).join('')}</div>
//                     <div class="markdown-body">${postHtml}</div>
//                     <p><strong>作者:</strong> ${postContent.author}</p>
//                     <p><strong>发布时间:</strong> ${postContent.time}</p>
//                 </body>
//                 </html>
//             `);
//         } else {
//             res.status(404).send(`帖子 "${postTitle}" 未找到`);
//         }
//     } catch (error) {
//         console.error('读取 part.json 文件失败:', error);
//         res.status(500).send('服务器错误');
//     }
// });

app.get('/api/lark/back', (req, res) => {
    const type = req.query.type; // 获取请求参数 type
    if (type == 'url_verification'){
        const token = req.query.token; // 获取验证 token
        if (token == 'FHbaThLwpNmg2U2BTw3FFd7x1o4rTuyK') {
            const challenge = req.query.challenge; // 获取验证挑战
            if (challenge) {
                // 返回验证挑战
                res.json({ challenge: challenge });
            } else {
                res.status(400).json({ error: '缺少 challenge 参数' });
            }
        } else {
            res.status(401).json({ error: '无效的验证 token' });
        }
    }
})

app.get('/BingSiteAuth.xml', (req, res) => {
    const filePath = path.join(__dirname, 'BingSiteAuth.xml');
    res.sendFile(filePath, err => {
        if (err) {
            res.status(404).send('BingSiteAuth.xml not found');
        }
    });
});