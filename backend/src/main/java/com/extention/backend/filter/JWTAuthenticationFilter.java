package com.extention.backend.filter;

import com.extention.backend.entity.User;
import com.extention.backend.request.UserRequest;
import com.extention.backend.utils.JWTUtil;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

public class JWTAuthenticationFilter extends OncePerRequestFilter {

    private final AuthenticationManager authenticationManager;
    private final JWTUtil jwtUtil;

    public JWTAuthenticationFilter(AuthenticationManager authenticationManager, JWTUtil jwtUtil) {
        this.authenticationManager = authenticationManager;
        this.jwtUtil = jwtUtil;
    }

    @Override
    protected  void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {

        if(!request.getServletPath().startsWith("/api/v1/auth/login")){
            filterChain.doFilter(request,response);
            return;
        }

        ObjectMapper objectMapper = new ObjectMapper();
        UserRequest login = objectMapper.readValue(request.getInputStream(), UserRequest.class);

        UsernamePasswordAuthenticationToken authToken= new UsernamePasswordAuthenticationToken(login.username(),login.password());

        Authentication authResult= authenticationManager.authenticate(authToken);
        System.out.println(authResult);
        System.out.println(authToken);

        User user= (User) authResult.getPrincipal();



        if(authResult.isAuthenticated() ){
            String token= jwtUtil.generateToken(authResult.getName(),user,60); //60 min
            response.setHeader("Authorization","Bearer "+token);

        }





    }
}
