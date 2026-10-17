FROM docker.io/library/node:24-alpine
WORKDIR /app
COPY server.js loadgen.js ./
EXPOSE 8080
CMD ["node", "server.js"]
