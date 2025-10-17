package com.extention.backend.utils;

import com.extention.backend.entity.User;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import io.jsonwebtoken.security.Keys;

import java.security.Key;
import java.util.Date;

@Component
public class JWTUtil {

    private final Key key;

    public JWTUtil() {
        String secret = "my-super-secure-secret-key-123456!";
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }


    public String generateToken(String email, User user, long expiryMinutes){
        return Jwts.builder()
                .setSubject(email)
                .claim("name", user.getFullName())
                .claim("id", user.getId())
                .setIssuedAt(new Date())
                .setExpiration(new Date(System.currentTimeMillis()+expiryMinutes*60*1000))
                .signWith(key, SignatureAlgorithm.HS256)
                .compact();

    }

    public    String validateAndExtractUsername(String token){
        try{
            return Jwts.parser()
                    .setSigningKey(key)
                    .build()
                    .parseClaimsJws(token)
                    .getBody()
                    .getSubject();
        }
        catch (JwtException e){
            return null;
        }
    }



    public boolean validateToken(String token, UserDetails userDetails) {
        String username = extractUsername(token);
        return username != null && username.equals(userDetails.getUsername());
    }

    public String extractUsername(String token) {
        return validateAndExtractUsername(token);
    }
}

