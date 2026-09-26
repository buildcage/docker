module github.com/buildcage/docker/inspect/buildcage-runc

go 1.26.0

require software.sslmate.com/src/go-pkcs12 v0.7.3

require golang.org/x/crypto v0.57.0 // indirect

replace software.sslmate.com/src/go-pkcs12 => github.com/buildcage/go-pkcs12 v0.7.3-buildcage.3
