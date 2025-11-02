# Use a lightweight OpenJDK 17 base image
FROM eclipse-temurin:17-jdk-alpine

# Set working directory
WORKDIR /app

# Copy the built JAR from target directory
COPY target/backend-0.0.1-SNAPSHOT.jar app.jar


# Expose the port your app runs on
EXPOSE 8098

# Run the application
ENTRYPOINT ["java", "-jar", "app.jar"]