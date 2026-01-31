const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

// 读取配置
let config = { port: 3000 };
try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (e) {
    console.warn('config.json not found or invalid, using default port 3000');
}

const app = express();
const port = config.port;

// 确保上传目录存在
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

// Multer 配置 (存储在内存中以便计算MD5，或者存临时文件)
// 这里为了方便计算MD5和移动文件，使用磁盘存储，但先不给扩展名
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
app.use(express.json());

// --- 路由 ---

// 1. 首页
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. 图片获取路由: /img/{timestamp}/{md5}
// 注意：实际上因为我们很难完全依赖时间戳去找文件(可能有毫秒误差)，
// 这里的实现逻辑是：文件名存储格式为 `timestamp_md5.ext`
// 或者我们建立一个简单的映射。
// 为了简化且无需数据库，我们将文件保存为 `md5.ext`，但 URL 路径允许带时间戳 (仅仅是为了展示或缓存控制)，
// 后端实际只根据 md5 查找文件。
app.get('/img/:ts/:hash', (req, res) => {
    const { hash } = req.params;
    
    // 查找匹配该 hash 的文件
    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) return res.status(500).send('Storage Error');
        
        // 寻找以 hash 开头的文件
        const file = files.find(f => f.startsWith(hash));
        
        if (file) {
            res.sendFile(path.join(UPLOAD_DIR, file));
        } else {
            res.status(404).send('Image not found');
        }
    });
});

// 3. 上传 API
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const tempPath = req.file.path;
    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase() || '.jpg';
    
    // 计算 MD5
    const fileBuffer = fs.readFileSync(tempPath);
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    const hex = hashSum.digest('hex');
    
    const timestamp = Date.now();
    
    // 最终文件名: hex + ext (避免重复存储相同文件)
    // 如果需要严格对应 URL 的 timestamp，可以在这里把 timestamp 也加进文件名，但为了去重通常只用 hash
    const finalFileName = `${hex}${ext}`;
    const finalPath = path.join(UPLOAD_DIR, finalFileName);

    // 重命名/移动文件
    fs.rename(tempPath, finalPath, (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'File save error' });
        }
        
        // 构建 URL
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

// 4. API 文档页面
app.get('/api/doc', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'doc.html'));
});

app.listen(port, () => {
    console.log(`Bloret Image Host running at http://localhost:${port}/`);
});