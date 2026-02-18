const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { spawn } = require('child_process');

let pythonProcess = null;
const PYTHON_PORT = 5000;

// Start Python Server
function startPythonServer() {
    console.log('正在启动 Python NSFW 检测服务...');
    
    // 假设 python 命令在环境变量中，或者你可以指定完整路径
    // 如果你的环境中是 python3，请修改为 python3
    pythonProcess = spawn('python', ['server.py', PYTHON_PORT], {
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

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const tempPath = req.file.path;
    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase() || '.jpg';
    
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