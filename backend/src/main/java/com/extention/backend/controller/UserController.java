package com.extention.backend.controller;

import com.extention.backend.entity.User;
import com.extention.backend.request.UserRequest;
import com.extention.backend.service.UserService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class UserController {
    @Autowired
    private UserService userService;

    @PostMapping
    public ResponseEntity<User> signUp(@RequestBody @Valid UserRequest userRequest){
        return  ResponseEntity.ok(userService.createUser(userRequest));
    }


}
