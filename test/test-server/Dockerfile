FROM nginx:stable-alpine3.23-slim@sha256:2fb5d772cea6ef1a8dab525df1b9485289eee167d26af9613fce27a12c060caa

RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 443 8080 8443

ENTRYPOINT ["/entrypoint.sh"]
