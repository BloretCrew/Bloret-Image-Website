import sys
import os
import logging
from flask import Flask, request, jsonify
from nudenet import NudeClassifier

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
classifier = None

def load_model():
    global classifier
    try:
        logger.info("正在加载 NudeNet 模型...")
        classifier = NudeClassifier()
        logger.info("NudeNet 模型加载完成")
    except Exception as e:
        logger.error(f"模型加载失败: {e}")
        sys.exit(1)

@app.route('/check', methods=['POST'])
def check_image():
    if not classifier:
        return jsonify({'error': 'Model not loaded'}), 503

    data = request.json
    file_path = data.get('file_path')
    
    if not file_path:
        return jsonify({'error': 'Missing file_path'}), 400
        
    if not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404

    try:
        logger.info(f"正在检查图片: {file_path}")
        # classify returns {path: {'safe': prob, 'unsafe': prob}}
        result = classifier.classify(file_path)
        preds = result.get(file_path, {})
        unsafe_prob = preds.get('unsafe', 0)
        
        is_nsfw = unsafe_prob > 0.5
        logger.info(f"检查结果: {file_path}, NSFW: {is_nsfw}, Probability: {unsafe_prob}")
        
        return jsonify({
            'is_nsfw': is_nsfw,
            'probability': unsafe_prob,
            'details': preds
        })
    except Exception as e:
        logger.error(f"检查出错: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/ping', methods=['GET'])
def ping():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    load_model()
    port = 5000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    
    logger.info(f"Python NSFW Server 正在启动，端口: {port}")
    app.run(host='127.0.0.1', port=port)
