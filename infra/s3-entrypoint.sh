#!/bin/sh
set -eu
umask 077
printf '{"identities":[{"name":"versus","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}' "$S3_ACCESS_KEY" "$S3_SECRET_KEY" > /tmp/s3.json
exec weed server -ip=s3 -ip.bind=0.0.0.0 -dir=/data -filer -s3 -s3.port=9000 -s3.config=/tmp/s3.json -volume.max=20 -master.volumeSizeLimitMB=100
