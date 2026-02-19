import sys
import os
import logging
import nudenet
from flask import Flask, request, jsonify

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', stream=sys.stdout)
logger = logging.getLogger(__name__)

app = Flask(__name__)
classifier = None
MODEL_TYPE = None

def load_model():
    global classifier, MODEL_TYPE
    try:
        logger.info("尝试加载 NudeClassifier 模型...")
        # 强制刷新缓冲区
        sys.stdout.flush()
        from nudenet import NudeClassifier
        classifier = NudeClassifier()
        MODEL_TYPE = 'classifier'
        logger.info("NudeClassifier 模型加载完成")
    except ImportError:
        logger.warning("未找到 NudeClassifier，尝试加载 NudeDetector...")
        try:
            from nudenet import NudeDetector
            classifier = NudeDetector()
            MODEL_TYPE = 'detector'
            logger.info("NudeDetector 模型加载完成")
        except ImportError:
            logger.error("无法加载 NudeClassifier 或 NudeDetector。请检查 nudenet 安装。")
            logger.error(f"当前 nudenet 模块内容: {dir(nudenet)}")
            sys.exit(1)
    except Exception as e:
        logger.error(f"模型加载失败: {e}")
        sys.exit(1)
    finally:
        sys.stdout.flush()

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
        logger.info(f"正在检查图片: {file_path} (使用 {MODEL_TYPE})")
        
        is_nsfw = False
        unsafe_prob = 0.0
        details = {}

        if MODEL_TYPE == 'classifier':
            # classify returns {path: {'safe': prob, 'unsafe': prob}}
            result = classifier.classify(file_path)
            preds = result.get(file_path, {})
            unsafe_prob = preds.get('unsafe', 0)
            is_nsfw = unsafe_prob > 0.5
            details = preds
            
        elif MODEL_TYPE == 'detector':
            # detect returns [{'box': [y_min, x_min, y_max, x_max], 'score': float, 'class': str}, ...]
            detections = classifier.detect(file_path)
            details = detections
            
            # 定义敏感标签
            NSFW_LABELS = [
                "FEMALE_GENITALIA_EXPOSED",
                "MALE_GENITALIA_EXPOSED",
                "ANUS_EXPOSED",
                "FEMALE_BREAST_EXPOSED",
                "BUTTOCKS_EXPOSED"
            ]
            
            max_score = 0
            for det in detections:
                # NudeDetector 返回的键是 'class' 而不是 'label'
                label = det.get('class')
                score = det.get('score', 0)
                if label in NSFW_LABELS and score > 0.5:
                    is_nsfw = True
                    max_score = max(max_score, score)
            
            unsafe_prob = max_score

        logger.info(f"检查结果: {file_path}, NSFW: {is_nsfw}, Probability/Score: {unsafe_prob}")
        
        return jsonify({
            'is_nsfw': is_nsfw,
            'probability': unsafe_prob,
            'details': details
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
