package com.extention.backend.controller;

import com.extention.backend.entity.User;
import com.extention.backend.repository.UserRepository;
import com.extention.backend.request.UserRequest;
import com.extention.backend.response.MeResponse;
import com.extention.backend.service.UserService;
import com.extention.backend.utils.AuthUserUtil;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class UserController {
    @Autowired
    private UserService userService;
    private final UserRepository userRepository;


    @PostMapping("/signup")
    public ResponseEntity<User> signUp(@RequestBody @Valid UserRequest userRequest){
        return  ResponseEntity.ok(userService.createUser(userRequest));
    }
    @GetMapping("/me")
    public ResponseEntity<MeResponse> me() {
        String username = AuthUserUtil.requireUsername();
        var user = userRepository.findByUsername(username).orElseThrow();
        return ResponseEntity.ok(new MeResponse(user.getId(), user.getFullName(), user.getUsername()));
    }




}
