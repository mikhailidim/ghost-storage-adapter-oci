FROM ghost:5
LABEL name="ghost-oci"
LABEL maintainer="Michael Mikhailidi"
LABEL description="Ghost blog with Oracle Cloud Infrastructure storage adaptrer"
LABEL version="1.0"
LABEL org.opencontainers.image.authors="Michael Mikhailidi"
LABEL org.opencontainers.image.description="Ghost blog with Oracle Cloud Infrastructure storage adapter"
LABEL org.opencontainers.image.version="1.0"

# Use the official Ghost image as the base image

RUN set -eux; \
# save list of currently installed packages for later so we can clean up
	savedAptMark="$(apt-mark showmanual)"; \
	apt-get update; \
	apt-get install -y --no-install-recommends ca-certificates gnupg wget; \
	rm -rf /var/lib/apt/lists/*; \
	\
	dpkgArch="$(dpkg --print-architecture | awk -F- '{ print $NF }')"; \
	wget -O /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch"; \
	wget -O /usr/local/bin/gosu.asc "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch.asc"; \
	\
# Copy the current directory contents into the container at /var/lib/ghost
RUN bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"
# Set the working directory to /var/lib/ghost/content
WORKDIR /var/lib/ghost/content
COPY OCiStorage.js oci.js
