FROM python:3.10-slim

WORKDIR /app

# Upgrade pip and install dependencies
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy all project files into the container
COPY . .

# Expose port for Flask
EXPOSE 5000

# Default command (we override this in docker-compose.yml)
CMD ["python", "app.py"]
