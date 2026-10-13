"""隔离日志库和模型密钥，测试不请求真实 LLM 或修改演示数据。"""
import os
os.environ['AGENT_DB_PATH']=':memory:'
os.environ['DEEPSEEK_API_KEY']=''
import main as agent
