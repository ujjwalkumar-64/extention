package com.extention.backend.service;

import com.extention.backend.entity.User;
import com.extention.backend.request.UserRequest;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.stereotype.Service;

@Service
public interface UserService extends UserDetailsService {
    User createUser(UserRequest user);

}
