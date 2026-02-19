const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { spawn } = require('child_process');

let pythonProcess = null;
const PYTHON_PORT = 5000;

const NSFW_LABEL_MAP = {
    "FEMALE_GENITALIA_EXPOSED": "女性生殖器暴露",
    "MALE_GENITALIA_EXPOSED": "男性生殖器暴露",
    "ANUS_EXPOSED": "肛门暴露",
    "FEMALE_BREAST_EXPOSED": "女性胸部暴露",
    "BUTTOCKS_EXPOSED": "臀部暴露"
};

// Start Python Server
function startPythonServer() {
    console.log('正在启动 Python NSFW 检测服务...');
    
    // 假设 python 命令在环境变量中，或者你可以指定完整路径
    // 如果你的环境中是 python3，请修改为 python3
    pythonProcess = spawn('python3', ['-u', 'server.py', PYTHON_PORT], { // 添加 -u 参数以禁用缓冲
        cwd: __dirname,
        stdio: 'inherit' // 让 Python 的输出显示在主进程控制台
    });

    pythonProcess.on('error', (err) => {
        console.error('无法启动 Python 进程:', err);
    });

    pythonProcess.on('close', (code) => {
        console.log(`Python 进程退出，退出码: ${code}`);
    });
}

startPythonServer();

// 优雅退出
process.on('exit', () => {
    if (pythonProcess) pythonProcess.kill();
});
process.on('SIGINT', () => {
    if (pythonProcess) pythonProcess.kill();
    process.exit();
});

let config = { port: 3000 };
try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (e) {
    console.warn('config.json not found or invalid, using default port 3000');
}

const app = express();
const port = config.port;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

const UNNSFW_DIR = path.join(__dirname, 'unNSFW');
if (!fs.existsSync(UNNSFW_DIR)) {
    fs.mkdirSync(UNNSFW_DIR);
}

const SF_DIRECTORY = path.join(__dirname, 'SFs');
if (!fs.existsSync(SF_DIRECTORY)) {
    fs.mkdirSync(SF_DIRECTORY);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR)
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, file.fieldname + '-' + uniqueSuffix)
    }
})

const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/SFs', express.static(SF_DIRECTORY));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/SF', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'SF.html'));
});

const sharp = require('sharp');

app.get('/api/svg_files', (req, res) => {
    fs.readdir(SF_DIRECTORY, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Unable to scan directory' });
        }
        const svgFiles = files.filter(file => file.endsWith('.svg'));
        res.json(svgFiles);
    });
});

app.get('/SF/:name', async (req, res) => {
    const iconName = req.params.name.endsWith('.svg') ? req.params.name : `${req.params.name}.svg`;
    const iconPath = path.join(SF_DIRECTORY, iconName);
    const color = req.query.color || 'black';
    const isPng = req.query.png === 'true';

    if (!fs.existsSync(iconPath)) {
        return res.status(404).send('Icon not found');
    }

    try {
        let svgBuffer = fs.readFileSync(iconPath);
        let svgString = svgBuffer.toString();

        // 替换 fill 或 stroke 颜色
        const coloredSvg = svgString.replace(/(fill|stroke)="[^"]*"/g, `$1="${color}"`);

        if (isPng) {
            const pngBuffer = await sharp(Buffer.from(coloredSvg)).png().toBuffer();
            res.type('image/png');
            res.send(pngBuffer);
        } else {
            res.type('image/svg+xml');
            res.send(coloredSvg);
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Error processing icon');
    }
});

app.get('/img/:ts/:hash', (req, res) => {
    const { hash } = req.params;
    
    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) return res.status(500).send('Storage Error');
        
        const file = files.find(f => f.startsWith(hash));
        
        if (file) {
            res.sendFile(path.join(UPLOAD_DIR, file));
        } else {
            res.status(404).send('Image not found');
        }
    });
});

async function isImageAdult(imagePath) {
    try {
        console.log(`正在请求 Python 服务检测图片: ${imagePath}`);
        // 使用原生 fetch 调用 Python 服务
        const response = await fetch(`http://127.0.0.1:${PYTHON_PORT}/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: imagePath })
        });

        if (!response.ok) {
            console.warn(`Python 服务响应错误: ${response.status} ${response.statusText}`);
            // 服务异常时，为了安全起见，拒绝上传并提示错误
            throw new Error(`NSFW Service Error: ${response.statusText}`);
        }

        const result = await response.json();
        console.log(`Python 服务检测结果:`, result);
        
        if (result.error) {
             console.error(`Python 服务内部错误: ${result.error}`);
             throw new Error(`NSFW Service Internal Error: ${result.error}`);
        }

        return {
            is_nsfw: result.is_nsfw === true,
            details: result.details || [],
            probability: result.probability || 0
        };

    } catch (error) {
        console.error("请求 Python NSFW 服务失败:", error.message);
        throw error; 
    }
}

app.post('/api/upload', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const tempPath = req.file.path;
    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase() || '.jpg';
    
    // NSFW Detection
    try {
        const nsfwResult = await isImageAdult(tempPath);
        if (nsfwResult.is_nsfw) {
            const finalFileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;
            const unNSFWPath = path.join(UNNSFW_DIR, finalFileName);
            
            fs.rename(tempPath, unNSFWPath, (err) => {
                if (err) {
                    console.error('Error moving NSFW file:', err);
                    return;
                }

                // 记录到 NSFW.json
                const nsfwLogPath = path.join(UNNSFW_DIR, 'NSFW.json');
                // 获取客户端 IP
                const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
                
                const logEntry = {
                    details: nsfwResult,
                    timestamp: new Date().toISOString(),
                    ip: clientIp
                };
                
                fs.readFile(nsfwLogPath, 'utf8', (readErr, data) => {
                    let logs = {};
                    if (!readErr && data) {
                        try {
                            const parsed = JSON.parse(data);
                            // 确保是对象且不是数组
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                                logs = parsed;
                            }
                        } catch (e) {
                            console.error('Error parsing NSFW.json, initializing new object:', e);
                        }
                    }
                    
                    logs[finalFileName] = logEntry;
                    
                    fs.writeFile(nsfwLogPath, JSON.stringify(logs, null, 2), (writeErr) => {
                        if (writeErr) console.error('Error writing to NSFW.json:', writeErr);
                    });
                });
            });
            
            // 构造详细的违规信息
            let violationDetails = '';
            if (nsfwResult.details && Array.isArray(nsfwResult.details)) {
                // 如果是 detector 模式，details 是数组
                const violations = nsfwResult.details
                    .filter(d => d.score > 0.5) // 过滤出超过阈值的项
                    .map(d => {
                        const labelCn = NSFW_LABEL_MAP[d.class] || d.class;
                        return `${labelCn} (置信度: ${(d.score * 100).toFixed(1)}%)`;
                    });
                
                if (violations.length > 0) {
                    violationDetails = `详细原因:\n${violations.join('\n')}`;
                }
            } else if (nsfwResult.details && typeof nsfwResult.details === 'object') {
                 // 如果是 classifier 模式，details 是对象 {safe: prob, unsafe: prob}
                 const unsafeProb = nsfwResult.probability;
                 violationDetails = `详细原因:\n色情内容 (置信度: ${(unsafeProb * 100).toFixed(1)}%)`;
            }

            return res.status(400).json({ 
                success: false, 
                message: `检测到违规内容，上传已拒绝。\n总置信度: ${(nsfwResult.probability * 100).toFixed(1)}%\n${violationDetails}` 
            });
        }
    } catch (err) {
        console.error('NSFW Check Error:', err);
        // 如果检测服务挂了，这里可以选择拒绝上传
        return res.status(500).json({ success: false, message: 'Image safety check failed. Please try again later.' });
    }
    
    const fileBuffer = fs.readFileSync(tempPath);
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    const hex = hashSum.digest('hex');
    
    const timestamp = Date.now();
    
    const finalFileName = `${hex}${ext}`;
    const finalPath = path.join(UPLOAD_DIR, finalFileName);

    fs.rename(tempPath, finalPath, (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'File save error' });
        }
        
        const url = `/img/${timestamp}/${hex}`;
        
        res.json({
            success: true,
            message: 'Upload successful',
            data: {
                url: url,
                timestamp: timestamp,
                md5: hex,
                filename: finalFileName
            }
        });
    });
});

app.get('/api/doc', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'doc.html'));
});

app.listen(port, () => {
    console.log(`Bloret Image Host running at http://localhost:${port}/`);
});