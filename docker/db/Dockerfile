# The "db" container: MariaDB, with a start script that keeps the application's account password
# in step with DB_PASSWORD in .env (the image itself only sets it when the volume is created).
FROM mariadb:11.4
COPY --chmod=755 sync-password.sh /usr/local/bin/qbl-db
ENTRYPOINT ["qbl-db"]
CMD ["mariadbd"]
