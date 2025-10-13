package com.extention.backend.service.serviceImpl;

import com.extention.backend.mapper.UserMapper;
import com.extention.backend.entity.User;
import com.extention.backend.repository.UserRepository;
import com.extention.backend.request.UserRequest;
import com.extention.backend.service.UserService;
import lombok.AllArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@AllArgsConstructor
public class UserServiceImpl  implements UserService {

    private UserRepository userRepository;
    private UserMapper userMapper;

    @Override
    public User createUser(UserRequest userRequest){
        return  userRepository.save(userMapper.toUser(userRequest));
    }
}
