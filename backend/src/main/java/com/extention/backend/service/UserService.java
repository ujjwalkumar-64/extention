package com.extention.backend.service;

import com.extention.backend.entity.User;
import com.extention.backend.request.UserRequest;
import org.springframework.stereotype.Service;

@Service
public interface UserService {
    User createUser(UserRequest user);
}
