FROM node:20-alpine AS frontend-build
WORKDIR /workspace/frontend/app/web
COPY frontend/app/web/package.json ./
RUN npm install
COPY frontend/app/web ./
ARG VITE_COGNITO_DOMAIN
ARG VITE_COGNITO_APP_CLIENT_ID
RUN printf "VITE_COGNITO_DOMAIN=%s\nVITE_COGNITO_APP_CLIENT_ID=%s\n" "$VITE_COGNITO_DOMAIN" "$VITE_COGNITO_APP_CLIENT_ID" > .env.production
RUN npm run build

FROM python:3.12-slim AS backend-runtime
WORKDIR /workspace

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY --from=frontend-build /workspace/frontend/app/web/dist ./frontend/app/web/dist

ENV APP_ENV=production
ENV PYTHONPATH=/workspace/backend
EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
