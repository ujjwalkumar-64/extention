package com.extention.backend.mapper;

import com.extention.backend.entity.User;
import com.extention.backend.request.UserRequest;
import org.springframework.stereotype.Service;

@Service
public class UserMapper {
    public User toUser(UserRequest userRequest){
        return User.builder()
                .fullName(userRequest.fullName())
                .username(userRequest.username())
                .password(userRequest.password())
                .build();
    }

}
