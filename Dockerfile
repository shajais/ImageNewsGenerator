FROM python:3.11-slim

# System libraries needed by OpenCV and InsightFace
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render injects PORT env var at runtime; default 3000 for local dev
ENV PORT=3000

EXPOSE 3000 10000

CMD ["python", "server.py"]
