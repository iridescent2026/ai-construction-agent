FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt ./
RUN python -m pip install -r requirements.txt
COPY . .
RUN useradd --uid 10001 --create-home appuser && mkdir -p /app/cloud-data && chown -R appuser:appuser /app
USER appuser
ENV DATA_DIR=/app/cloud-data DEMO_MODE=1 FACTORY_ANALYSIS_DEMO=1
EXPOSE 10000
CMD ["python", "run_cloud.py"]
