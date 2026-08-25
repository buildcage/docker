FROM nginx:stable-alpine3.23-slim@sha256:2c605dbeab79a6b2a63340474fe58119d0ef95bdc4b1f41df0aa689659b3d13b

COPY nginx.conf /etc/nginx/nginx.conf
COPY cert.pem key.pem /etc/nginx/

EXPOSE 80 443 8080 8443 9080 9443
